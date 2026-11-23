import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { BridgeError } from "./bridge-error.js";
import type { BridgeRequest } from "./bridge-client.js";
import { KNOWN_ERROR_CODES } from "./tool-defs.js";
import { createScreenshotResult, ScreenshotOptionsSchema }
  from "./screenshot-result.js";
import { validateScreenshotPath } from "./screenshot-storage.js";

const ToolMetadataSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
});

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
// The extension stops waiting shortly before the bridge budget expires, so
// the budget must exceed the longest wait the caller asked for.
const LONG_WAIT_HEADROOM_MS = 10_000;
const WaitForTimeoutSchema = z.object({ timeoutMs: z.number() });
const PollingScriptSchema = z.object({
  timeoutMs: z.number(), untilTruthyMs: z.number(),
});
const SESSION_ID = randomUUID();
const SESSION_TOOLS = new Set(["tabs_create", "tabs_context", "tabs_close"]);

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
}

export interface BridgeRequester {
  request(input: BridgeRequest): Promise<unknown>;
}

interface RegisteredTool {
  definition: ToolDefinition;
  mcpTool: Tool;
}

export interface ToolRegistryOptions {
  defaultTimeoutMs?: number;
}

const ERROR_HINT_TEXT = {
  BRIDGE_NOT_RUNNING: "请打开 Chrome 并启用 mie 插件",
  NOT_SENT: "未送达, 可安全重试",
  SENT_LINK_LOST: "已发出但结果未知, 请先截图确认副作用",
  TIMEOUT: "请求超时, 请检查页面状态后再决定是否重试",
  TAB_GONE: "目标标签页已不存在, 请重新获取标签页上下文",
  TOOL_ERROR: "工具执行失败, 具体原因和处理建议见 message",
  INVALID_SECRET_SOURCE: "凭据文件未获授权或不符合安全读取要求",
  SECRET_TARGET_MISMATCH: "目标密码框或页面与授权不匹配, 请重新确认目标",
  SECRET_INPUT_FAILED: "密码设置失败且结果可能未知, 不要自动重试或回读凭据",
  PROFILE_NOT_FOUND: "未发现指定 profile, 请检查名称或调用 profiles_list",
  PROFILE_OFFLINE: "指定 profile 离线, 请打开对应 Chrome profile 并启用 mie",
  PROFILE_CONFLICT: "多个在线 profile 重名, 请在 mie 中设置不同名称",
  PROFILE_IDENTITY_MISMATCH: "profile 身份已变化, 请重新获取列表并确认目标",
} satisfies Record<(typeof KNOWN_ERROR_CODES)[number], string>;

const ERROR_HINTS: ReadonlyMap<string, string> = new Map(
  KNOWN_ERROR_CODES.map((code) => [code, ERROR_HINT_TEXT[code]]),
);

const LOCAL_ERROR_HINTS: Readonly<Record<string, string>> = {
  TOOL_NOT_FOUND: "工具不存在, 请刷新工具列表并检查工具名",
  INVALID_ARGUMENT: "参数校验失败, 请修正参数后再调用",
  PROFILE_LAUNCH_NOT_CONFIGURED: "请配置 MIE_PROFILE_LAUNCH_CONFIG 启动映射, " +
    "或手动打开对应 Chrome profile",
  PROFILE_LAUNCH_CONFIG_INVALID: "请检查本机启动映射的格式、权限和已有 Chrome 路径",
  PROFILE_LAUNCH_FAILED: "启动失败, 请核实本机 Chrome 配置和 profiles_list, 不要重放之前结果未知的操作",
  PROFILE_LAUNCH_TIMEOUT: "等待身份确认超时, Chrome 可能仍在启动且未被终止, " +
    "请用 profiles_list 核实, 不要自动再次启动或重放旧操作",
};

const CLOSE_LINK_LOST_HINT = "关闭请求已发出但结果未知, profile 可能离线. " +
  "请先调用 profiles_list; 离线时可在配置本机映射后调用 profiles_launch, " +
  "或手动打开对应 Chrome profile. 恢复后用 tabs_context 核实受管标签页, " +
  "不要把断连当作关闭成功, 不要自动重试关闭";

const UNKNOWN_ERROR_HINT = "未知 bridge 错误, 请检查诊断并确认页面状态";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly defaultTimeoutMs: number;

  constructor(
    definitions: readonly ToolDefinition[],
    private readonly bridgeClient: BridgeRequester,
    options: ToolRegistryOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

    if (
      !Number.isInteger(this.defaultTimeoutMs) ||
      this.defaultTimeoutMs <= 0
    ) {
      throw new TypeError("The default tool timeout must be a positive integer.");
    }

    for (const definition of definitions) {
      this.register(definition);
    }
  }

  listTools(): Tool[] {
    return [...this.tools.values()].map(({ mcpTool }) => mcpTool);
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const tool = this.tools.get(name);

    if (tool === undefined) {
      return createErrorResult("TOOL_NOT_FOUND", `Unknown tool: ${name}.`);
    }

    if (SESSION_TOOLS.has(name) && isRecord(args)
      && Object.hasOwn(args, "sessionId")) {
      return createErrorResult("INVALID_ARGUMENT",
        "sessionId is managed by the MCP server and cannot be supplied.");
    }

    const parsed = await tool.definition.inputSchema.safeParseAsync(
      sessionArguments(name, args),
    );

    if (!parsed.success) {
      return createErrorResult(
        "INVALID_ARGUMENT",
        "Tool arguments failed validation.",
        parsed.error.issues,
      );
    }

    try {
      return await this.execute(name, parsed.data);
    } catch (error) {
      if (error instanceof BridgeError) {
        return createErrorResult(error.code, error.message, error.data,
          name === "tabs_close" && error.code === "SENT_LINK_LOST"
            ? CLOSE_LINK_LOST_HINT : undefined);
      }

      return createErrorResult(
        "TOOL_ERROR",
        "Unexpected tool execution error.",
        error,
      );
    }
  }

  private requestTimeoutMs(name: string, args: unknown): number {
    const waitMs = requestedWaitMs(name, args);
    return waitMs === undefined ? this.defaultTimeoutMs
      : Math.max(this.defaultTimeoutMs, waitMs + LONG_WAIT_HEADROOM_MS);
  }

  private async execute(name: string, args: unknown): Promise<CallToolResult> {
    const screenshot = name === "computer"
      ? ScreenshotOptionsSchema.safeParse(args) : undefined;
    if (screenshot?.success && screenshot.data.savePath !== undefined) {
      validateScreenshotPath(screenshot.data.savePath, screenshot.data.format);
    }
    const bridgeArgs = screenshot?.success && isRecord(args)
      ? Object.fromEntries(Object.entries(args).filter(
        ([key]) => key !== "savePath" && key !== "overwrite",
      )) : args;
    const payload = await this.bridgeClient.request({
      tool: name, args: bridgeArgs,
      timeoutMs: this.requestTimeoutMs(name, args),
    });
    return screenshot?.success
      ? createScreenshotResult(payload, screenshot.data)
      : createSuccessResult(payload);
  }

  private register(definition: ToolDefinition): void {
    const metadata = ToolMetadataSchema.safeParse({
      name: definition.name,
      description: definition.description,
    });

    if (!metadata.success) {
      throw new TypeError("Invalid tool definition metadata.", {
        cause: metadata.error,
      });
    }

    if (!(definition.inputSchema instanceof z.ZodType)) {
      throw new TypeError(`Tool ${definition.name} has an invalid input schema.`);
    }

    if (this.tools.has(definition.name)) {
      throw new TypeError(`Duplicate tool definition: ${definition.name}.`);
    }

    const inputSchema = z.toJSONSchema(definition.inputSchema, {
      target: "draft-07",
      io: "input",
      reused: "inline",
    });
    const mcpInputSchema = normalizeInputSchema(definition.name, inputSchema);

    this.tools.set(definition.name, {
      definition,
      mcpTool: {
        name: definition.name,
        description: definition.description,
        inputSchema: mcpInputSchema,
      },
    });
  }
}

function requestedWaitMs(name: string, args: unknown): number | undefined {
  if (name === "wait_for") {
    return WaitForTimeoutSchema.safeParse(args).data?.timeoutMs;
  }
  if (name === "javascript_exec") {
    const polling = PollingScriptSchema.safeParse(args).data;
    return polling === undefined ? undefined
      : polling.untilTruthyMs + polling.timeoutMs;
  }
  return undefined;
}

function sessionArguments(name: string, args: unknown): unknown {
  if (!SESSION_TOOLS.has(name) || !isRecord(args)) return args;
  return name === "tabs_create" || name === "tabs_close"
    || args["mineOnly"] === true
    ? { ...args, sessionId: SESSION_ID } : args;
}

function createSuccessResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload ?? null),
      },
    ],
    structuredContent:
      isRecord(payload) ? payload : { payload: payload ?? null },
  };
}

function createErrorResult(
  code: string,
  message: string,
  data?: unknown,
  hintOverride?: string,
): CallToolResult {
  const hint =
    hintOverride ?? LOCAL_ERROR_HINTS[code] ?? ERROR_HINTS.get(code)
      ?? UNKNOWN_ERROR_HINT;
  const error = {
    code,
    message,
    hint,
    ...(data === undefined ? {} : { data: toJsonValue(data) }),
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(error),
      },
    ],
    structuredContent: { error },
    isError: true,
  };
}

function normalizeInputSchema(
  toolName: string,
  inputSchema: object,
): Tool["inputSchema"] {
  const schema = inputSchema as Record<string, unknown>;

  if (schema["type"] === "object") {
    const properties = schema["properties"];
    return {
      ...schema,
      ...(isRecord(properties) ? {
        properties: Object.fromEntries(Object.entries(properties)
          .filter(([key]) => !SESSION_TOOLS.has(toolName) || key !== "sessionId")
          .map(
          ([key, value]) => [key, normalizeFixedTuple(value)],
        )),
      } : {}),
    } as Tool["inputSchema"];
  }

  const variants = schema["anyOf"];
  if (
    Array.isArray(variants) &&
    variants.length > 0 &&
    variants.every(
      (variant) => isRecord(variant) && variant["type"] === "object",
    )
  ) {
    return { ...schema, type: "object" } as Tool["inputSchema"];
  }

  throw new TypeError(`Tool ${toolName} must use an object schema.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFixedTuple(value: unknown): unknown {
  if (!isRecord(value) || value["type"] !== "array") {
    return value;
  }
  const items = value["items"];
  if (
    !Array.isArray(items) || items.length === 0 ||
    value["minItems"] !== items.length ||
    value["maxItems"] !== items.length ||
    !items.every((item) => isDeepStrictEqual(item, items[0]))
  ) {
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "additionalItems")
    .map(([key, entry]) => [key, key === "items" ? items[0] : entry]));
}

function toJsonValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}
