import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BridgeError } from "../src/bridge-error.js";
import {
  ToolRegistry,
  type BridgeRequester,
} from "../src/tool-registry.js";

const TOOL_DEFINITION = {
  name: "stub.echo",
  description: "Echo a message.",
  inputSchema: z.object({ message: z.string() }).strict(),
};

class RecordingBridge implements BridgeRequester {
  readonly requests: unknown[] = [];

  constructor(
    private readonly result: unknown,
    private readonly error: unknown = undefined,
  ) {}

  async request(input: unknown): Promise<unknown> {
    this.requests.push(input);
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.result;
  }
}

describe("ToolRegistry", () => {
  it("preserves heterogeneous tuple schemas", () => {
    const registry = new ToolRegistry([{
      ...TOOL_DEFINITION,
      inputSchema: z.object({ pair: z.tuple([z.string(), z.number()]) }),
    }], new RecordingBridge({}));
    expect(registry.listTools()[0]?.inputSchema.properties?.["pair"])
      .toMatchObject({
        items: [{ type: "string" }, { type: "number" }],
        minItems: 2, maxItems: 2, additionalItems: false,
      });
  });

  it("derives MCP JSON Schema from the Zod tool definition", () => {
    const registry = new ToolRegistry(
      [TOOL_DEFINITION],
      new RecordingBridge({}),
    );

    expect(registry.listTools()).toEqual([
      expect.objectContaining({
        name: "stub.echo",
        description: "Echo a message.",
        inputSchema: expect.objectContaining({
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
          },
        }),
      }),
    ]);
  });

  it("rejects invalid arguments before calling the bridge", async () => {
    const bridge = new RecordingBridge({});
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge);

    const result = await registry.callTool("stub.echo", { message: 1 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "INVALID_ARGUMENT",
        hint: "参数校验失败, 请修正参数后再调用",
      },
    });
    expect(bridge.requests).toEqual([]);
  });

  it("returns a local error for an unknown tool name", async () => {
    const registry = new ToolRegistry(
      [TOOL_DEFINITION],
      new RecordingBridge({}),
    );

    const result = await registry.callTool("missing", {});

    expect(result.structuredContent).toMatchObject({
      error: {
        code: "TOOL_NOT_FOUND",
        hint: "工具不存在, 请刷新工具列表并检查工具名",
      },
    });
  });

  it("forwards validated arguments and returns the bridge payload", async () => {
    const bridge = new RecordingBridge({ echoed: "hello" });
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge, {
      defaultTimeoutMs: 200,
    });

    const result = await registry.callTool("stub.echo", { message: "hello" });

    expect(bridge.requests).toEqual([
      {
        tool: "stub.echo",
        args: { message: "hello" },
        timeoutMs: 200,
      },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ echoed: "hello" });
  });

  it.each([
    ["BRIDGE_NOT_RUNNING", "请打开 Chrome 并启用 mie 插件"],
    ["NOT_SENT", "未送达, 可安全重试"],
    ["SENT_LINK_LOST", "已发出但结果未知, 请先截图确认副作用"],
    ["TIMEOUT", "请求超时, 请检查页面状态后再决定是否重试"],
    ["TAB_GONE", "目标标签页已不存在, 请重新获取标签页上下文"],
    ["TOOL_ERROR", "工具执行失败, 具体原因和处理建议见 message"],
    ["INVALID_SECRET_SOURCE", "凭据文件未获授权或不符合安全读取要求"],
    ["SECRET_TARGET_MISMATCH", "目标密码框或页面与授权不匹配, 请重新确认目标"],
    ["SECRET_INPUT_FAILED", "密码设置失败且结果可能未知, 不要自动重试或回读凭据"],
  ])("maps %s to an actionable MCP error", async (code, hint) => {
    const bridge = new RecordingBridge(
      undefined,
      new BridgeError(code, "Bridge failure."),
    );
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge);

    const result = await registry.callTool("stub.echo", { message: "hello" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code, hint },
    });
  });

  it("preserves unknown bridge error codes", async () => {
    const bridge = new RecordingBridge(
      undefined,
      new BridgeError("FUTURE_ERROR", "Future failure."),
    );
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge);

    const result = await registry.callTool("stub.echo", { message: "hello" });

    expect(result.structuredContent).toMatchObject({
      error: {
        code: "FUTURE_ERROR",
        hint: "未知 bridge 错误, 请检查诊断并确认页面状态",
      },
    });
  });

  it("does not classify an unknown injected failure as safely retryable", async () => {
    const bridge = new RecordingBridge(
      undefined,
      new Error("Unknown requester failure."),
    );
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge);

    const result = await registry.callTool("stub.echo", { message: "hello" });

    expect(result.structuredContent).toMatchObject({
      error: {
        code: "TOOL_ERROR",
        hint: "工具执行失败, 具体原因和处理建议见 message",
      },
    });
  });

  it("preserves obscured result metadata as a success", async () => {
    const bridge = new RecordingBridge({ obscured: true, clicked: true });
    const registry = new ToolRegistry([TOOL_DEFINITION], bridge);

    const result = await registry.callTool("stub.echo", { message: "hello" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      obscured: true,
      clicked: true,
    });
  });

  it("extends the bridge budget beyond a long wait_for timeout", async () => {
    const bridge = new RecordingBridge({});
    const registry = new ToolRegistry([{
      name: "wait_for", description: "Wait.",
      inputSchema: z.object({ timeoutMs: z.number().int().min(0) }).strict(),
    }, TOOL_DEFINITION], bridge);

    await registry.callTool("wait_for", { timeoutMs: 300_000 });
    await registry.callTool("wait_for", { timeoutMs: 5_000 });
    await registry.callTool("stub.echo", { message: "hello" });

    expect(bridge.requests).toEqual([
      expect.objectContaining({ tool: "wait_for", timeoutMs: 310_000 }),
      expect.objectContaining({ tool: "wait_for", timeoutMs: 30_000 }),
      expect.objectContaining({ tool: "stub.echo", timeoutMs: 30_000 }),
    ]);
  });
});
