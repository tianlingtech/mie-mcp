import { describe, expect, it } from "vitest";

import {
  EXPECTED_PROTOCOL_VERSION,
  EXPECTED_TOOL_DEFS_VERSION,
  P0_TOOL_DEFINITIONS,
} from "../src/tool-defs.js";
import {
  ToolRegistry,
  type BridgeRequester,
} from "../src/tool-registry.js";

class RecordingBridge implements BridgeRequester {
  readonly requests: unknown[] = [];

  async request(input: unknown): Promise<unknown> {
    this.requests.push(input);
    return { tool: (input as { tool: string }).tool };
  }
}

const SHARED_TOOL_NAMES = [
  "tabs_context",
  "tabs_create",
  "tabs_close",
  "navigate",
  "computer",
  "read_page",
  "get_page_text",
  "find",
  "form_input",
  "read_console_messages",
  "read_network_requests",
  "read_network_request",
  "set_input_files",
  "observation_history",
  "set_password_from_file",
  "profiles_list",
  "javascript_exec",
  "hover",
  "set_viewport",
  "inspect_element",
  "wait_for",
  "request",
  "profiles_launch",
  "screenshot_diagnostics",
  "graphics_diagnostics",
  "cookies_list",
] as const;

const VALID_CALLS = [
  ["screenshot_diagnostics", { action: "read", limit: 20 }],
  ["screenshot_diagnostics", { action: "clear" }],
  ["tabs_context", {}],
  ["tabs_create", { url: "https://example.com/" }],
  ["tabs_close", { tabIds: [1] }],
  [
    "navigate",
    { tabId: 1, url: "https://example.com/", waitUntil: "load" },
  ],
  ["computer", { tabId: 1, action: "click", coordinate: [10, 20] }],
  ["computer", { tabId: 1, action: "type", text: "hello" }],
  [
    "computer",
    { tabId: 1, action: "key", key: "Enter", modifiers: ["Shift"] },
  ],
  [
    "computer",
    { tabId: 1, action: "scroll", direction: "down", distance: 100 },
  ],
  ["computer", { tabId: 1, action: "wait", milliseconds: 100 }],
  ["read_page", { tabId: 1, maxChars: 1_000 }],
  ["get_page_text", { tabId: 1, maxChars: 1_000, includeFrames: false }],
  ["find", { tabId: 1, query: "Submit", exact: false }],
  ["find", { tabId: 1, selector: "[data-testid=\"x\"]", exact: false }],
  ["find", { tabId: 1, query: "Submit", exact: false, includeBox: true }],
  ["form_input", { tabId: 1, backendNodeId: 7, value: "hello" }],
  ["form_input", { tabId: 1, backendNodeId: 7, value: true }],
  ["form_input", { tabId: 1, backendNodeId: 7, value: 42 }],
  ["form_input", { tabId: 1, backendNodeId: 7, clear: true }],
  [
    "read_console_messages",
    { tabId: 1, pattern: "ERROR", onlyErrors: true, limit: 1, clear: true,
      includeSubSessions: false },
  ],
  [
    "read_network_requests",
    { tabId: 1, urlPattern: "/API", limit: 200, clear: true,
      includeSubSessions: false },
  ],
  [
    "read_network_request",
    { tabId: 1, requestId: "req.1", maxChars: 20_000, includeBody: true,
      includeRequestBody: false, includeHeaders: true },
  ],
  ["set_input_files", { tabId: 1, backendNodeId: 7, files: [] }],
  ["javascript_exec", { tabId: 1, expectedOrigin: "https://example.com",
    allowUnsafe: true, code: "return 1;", timeoutMs: 5000, maxChars: 20_000 }],
  ["hover", { tabId: 1, backendNodeId: 7, frameId: "frame-a" }],
  ["set_viewport", { tabId: 1, width: 1024, height: 768 }],
  ["inspect_element", { tabId: 1, backendNodeId: 7 }],
  ["wait_for", { tabId: 1, selector: "#ready", state: "visible", timeoutMs: 100 }],
  ["request", { tabId: 1, expectedOrigin: "https://example.com", url: "/api",
    method: "GET", allowWrite: false, timeoutMs: 1000, maxBytes: 2000 }],
  ["observation_history", { action: "status" }],
  ["set_password_from_file", {
    tabId: 1, backendNodeId: 7, filePath: "/tmp/mie-dummy.key",
    expectedOrigin: "https://example.com", expectedPathname: "/settings",
  }],
  ["profiles_list", {}],
  ["graphics_diagnostics", { tabId: 1, maxCanvases: 10 }],
  ["cookies_list", { url: "https://example.com/" }],
  ["cookies_list", { domain: "example.com", name: "sid" }],
  ["profiles_launch", { profile: "fixture", timeoutMs: 1000 }],
] as const;

describe("shared tool definitions", () => {
  it("exposes the shared protocol and tool definition versions", () => {
    expect(EXPECTED_PROTOCOL_VERSION).toBe(1);
    expect(EXPECTED_TOOL_DEFS_VERSION).toMatch(/^0\.\d+\.\d+$/);
  });

  it("registers every shared tool with derived input schemas", () => {
    const registry = new ToolRegistry(P0_TOOL_DEFINITIONS, new RecordingBridge());
    const tools = registry.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      SHARED_TOOL_NAMES,
    );
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).toHaveProperty("$schema");
    }

    const computer = tools.find((tool) => tool.name === "computer");
    const computerSchema = computer?.inputSchema as
      | Record<string, unknown>
      | undefined;
    // Flat object with a full action enum: every action must be visible in
    // the schema itself (a top-level anyOf hides them in some MCP clients).
    expect(computer?.inputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["tabId", "action"]),
      properties: expect.objectContaining({
        action: expect.objectContaining({
          enum: ["screenshot", "click", "drag", "type", "key", "scroll", "wait"],
        }),
      }),
    });
    expect(computerSchema).not.toHaveProperty("anyOf");
  });

  it("matches the derived JSON Schema contract snapshots", () => {
    const registry = new ToolRegistry(P0_TOOL_DEFINITIONS, new RecordingBridge());

    for (const tool of registry.listTools()) {
      expect(tool.inputSchema).toMatchSnapshot(tool.name);
      expect({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }).toMatchSnapshot(`${tool.name} contract`);
    }
  });

  it("exposes optional profile on browser tools and no selector on the list", () => {
    const registry = new ToolRegistry(P0_TOOL_DEFINITIONS, new RecordingBridge());
    for (const tool of registry.listTools()) {
      if (tool.name === "profiles_list") {
        expect(tool.inputSchema.properties).toEqual({});
      } else {
        expect(tool.inputSchema.properties?.profile).toMatchObject({
          type: "string", minLength: 1, maxLength: 48,
        });
        if (tool.name === "profiles_launch") {
          expect(tool.inputSchema.required).toContain("profile");
        } else {
          expect(tool.inputSchema.required ?? []).not.toContain("profile");
        }
      }
    }
  });

  it("forwards every shared tool call through the existing bridge interface", async () => {
    const bridge = new RecordingBridge();
    const registry = new ToolRegistry(P0_TOOL_DEFINITIONS, bridge, {
      defaultTimeoutMs: 200,
    });

    for (const [name, args] of VALID_CALLS) {
      const result = await registry.callTool(name, args);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ tool: name });
    }

    expect(bridge.requests).toEqual(
      VALID_CALLS.map(([tool, args]) => ({
        tool,
        args: tool === "tabs_create" || tool === "tabs_close"
          ? { ...args, sessionId: expect.any(String) } : args,
        timeoutMs: tool === "wait_for" ? 10_100 : 200,
      })),
    );
  });

  it("budgets polling javascript_exec calls from the parsed timeouts", async () => {
    const bridge = new RecordingBridge();
    const registry = new ToolRegistry(P0_TOOL_DEFINITIONS, bridge);
    const script = { tabId: 1, expectedOrigin: "https://example.com",
      allowUnsafe: true, code: "return 1;" };

    await registry.callTool("javascript_exec", { ...script, untilTruthyMs: 300_000 });
    await registry.callTool("javascript_exec",
      { ...script, untilTruthyMs: 1_000, timeoutMs: 15_000 });
    await registry.callTool("javascript_exec", script);

    expect(bridge.requests).toEqual([
      expect.objectContaining({ timeoutMs: 315_000 }),
      expect.objectContaining({ timeoutMs: 30_000 }),
      expect.objectContaining({ timeoutMs: 30_000 }),
    ]);
  });
});
