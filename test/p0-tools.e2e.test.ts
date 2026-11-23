import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";
import { PACKAGE_VERSION } from "../src/package-info.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
  for (const bridge of bridges.splice(0)) {
    await bridge.stop();
  }
});

async function start(): Promise<{ bridge: FakeBridge; harness: McpHarness }> {
  const bridge = await FakeBridge.start();
  const harness = await startMcpClient(bridge.tempDirectory);
  bridges.push(bridge);
  harnesses.push(harness);
  return { bridge, harness };
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
  "cookies_list",
] as const;

const SHARED_CALLS = [
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
  ["javascript_exec", { tabId: 1, expectedOrigin: "https://example.com",
    allowUnsafe: true, code: "return 1;", timeoutMs: 5000, untilTruthyMs: 1000,
    maxChars: 20_000 }],
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
  ["cookies_list", { url: "https://example.com/" }],
] as const;

describe("shared tools over MCP stdio", () => {
  it("lists and calls every shared tool", async () => {
    const { bridge, harness } = await start();
    const listed = await harness.client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual(
      SHARED_TOOL_NAMES,
    );
    const computer = listed.tools.find((tool) => tool.name === "computer");
    expect(computer?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        action: expect.objectContaining({ enum: expect.any(Array) }),
      }),
    });
    expect(computer?.inputSchema).not.toHaveProperty("anyOf");

    for (const [name, args] of SHARED_CALLS) {
      const result = await harness.client.callTool({
        name,
        arguments: args,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(
        name === "tabs_create" || name === "tabs_close"
        ? { ...args, sessionId: expect.any(String) } : args);
    }

    expect(bridge.receivedRequests.map(({ tool, args }) => ({ tool, args }))).toEqual(
      SHARED_CALLS.map(([tool, args]) => ({ tool,
        args: tool === "tabs_create" || tool === "tabs_close"
          ? { ...args, sessionId: expect.any(String) } : args })),
    );
    const profiles = await harness.client.callTool({
      name: "profiles_list", arguments: {},
    });
    expect(profiles.structuredContent).toEqual({
      serverVersion: PACKAGE_VERSION, profiles: [],
    });
    expect(bridge.receivedRequests).toHaveLength(SHARED_CALLS.length);
  });

  it("preserves obscured=true as a successful result", async () => {
    const bridge = await FakeBridge.start({
      responses: [
        { kind: "success", payload: { obscured: true, clicked: true } },
      ],
    });
    const harness = await startMcpClient(bridge.tempDirectory);
    bridges.push(bridge);
    harnesses.push(harness);

    const result = await harness.client.callTool({
      name: "computer",
      arguments: { tabId: 1, action: "click", coordinate: [10, 20] },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      obscured: true,
      clicked: true,
    });
  });

  it("preserves an unknown bridge error code with a generic hint", async () => {
    const bridge = await FakeBridge.start({
      responses: [
        {
          kind: "error",
          error: { code: "FUTURE_ERROR", message: "Future failure." },
        },
      ],
    });
    const harness = await startMcpClient(bridge.tempDirectory);
    bridges.push(bridge);
    harnesses.push(harness);

    const result = await harness.client.callTool({
      name: "tabs_context",
      arguments: {},
    });

    expect(result.structuredContent).toMatchObject({
      error: {
        code: "FUTURE_ERROR",
        hint: "未知 bridge 错误, 请检查诊断并确认页面状态",
      },
    });
  });
});
