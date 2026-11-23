import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

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

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start({
    ...options,
    hello: { tool_defs_version: EXPECTED_TOOL_DEFS_VERSION },
  });
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

const OBSERVATION_TOOLS = [
  {
    name: "read_console_messages",
    filter: "pattern",
    defaults: { limit: 100, clear: false, onlyErrors: false,
      includeSubSessions: false },
  },
  {
    name: "read_network_requests",
    filter: "urlPattern",
    defaults: { limit: 100, clear: false, includeSubSessions: false },
  },
] as const;

describe.each(OBSERVATION_TOOLS)("$name over MCP stdio", (tool) => {
  it("injects shared defaults before writing the bridge frame", async () => {
    const { bridge, client } = await start();
    const args = { tabId: 1, ...tool.defaults };
    const result = await client.callTool({
      name: tool.name,
      arguments: { tabId: 1 },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(args);
    expect(bridge.receivedRequests).toEqual([
      expect.objectContaining({
        type: "tool_request",
        tool: tool.name,
        args,
      }),
    ]);
  });

  it("preserves explicit boundaries and JSON text payloads", async () => {
    const payload = {
      content: JSON.stringify({
        entries: [{ text: "MiXeD case: \"value\"\nnext line" }],
        dropped: 2,
        invalidEvents: 1,
        omitted: 3,
        scope: "main-session",
      }),
    };
    const { bridge, client } = await start({
      responses: [
        { kind: "success", payload },
        { kind: "success", payload },
      ],
    });
    const calls = [1, 200].map((limit) => ({
      tabId: 1,
      limit,
      clear: limit === 200,
      includeSubSessions: false,
      [tool.filter]: limit === 1 ? "A" : "MiXeD".repeat(40),
      ...(tool.name === "read_console_messages"
        ? { onlyErrors: limit === 200 }
        : {}),
    }));

    for (const args of calls) {
      const result = await client.callTool({ name: tool.name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid inputs without connecting to the bridge", async () => {
    const { bridge, client } = await start();
    const invalidArguments = [
      {},
      { tabId: 0 },
      { tabId: -1 },
      { tabId: 1.5 },
      { tabId: "1" },
      ...[0, 201, 1.5, "100"].map((limit) => ({ tabId: 1, limit })),
      ...["", "x".repeat(201), 1].map((filter) => ({
        tabId: 1,
        [tool.filter]: filter,
      })),
      { tabId: 1, clear: "false" },
      { tabId: 1, unexpected: true },
      ...["true", 0, null].map((includeSubSessions) => ({
        tabId: 1, includeSubSessions,
      })),
      { tabId: 1, sessionId: "child" },
      ...(tool.name === "read_console_messages"
        ? [{ tabId: 1, onlyErrors: "false" }, { tabId: 1, urlPattern: "/" }]
        : [{ tabId: 1, onlyErrors: false }, { tabId: 1, pattern: "error" }]),
    ];

    for (const args of invalidArguments) {
      const result = await client.callTool({ name: tool.name, arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.receivedRequests).toEqual([]);
    expect(bridge.connectionCount).toBe(0);
  });

  it("preserves substring compatibility and RE2 patterns without rewriting", async () => {
    const { bridge, client } = await start();
    const filters = [
      { [tool.filter]: "(?=literal)[" },
      { [tool.filter]: "(literal)\\1", patternMode: "substring" },
      { patternMode: "substring" },
      ...["^MiXeD.*(error|warning)$", "(?i)api/[0-9]+", "(?-i)ERROR",
        "\\p{Han}+", `(?:${"x|".repeat(97)}x)y`, "x{126}"].map((pattern) => ({
        [tool.filter]: pattern, patternMode: "regex",
      })),
    ];
    for (const filter of filters) {
      const result = await client.callTool({
        name: tool.name, arguments: { tabId: 1, ...filter },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        tabId: 1, ...tool.defaults, ...filter,
      });
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(
      filters.map((filter) => ({ tabId: 1, ...tool.defaults, ...filter })),
    );
  });

  it("rejects unsupported regex and mode combinations before connecting", async () => {
    const { bridge, client } = await start();
    const invalid = [
      { patternMode: "regex" },
      ...["", "[", "(", "(?=a)", "(?!a)", "(?<=a)b", "(?<!a)b",
        "(a)\\1", "x".repeat(201), "x{127}",
        "(?i)(?:[a-z]?){1000}[0-9]"].map((pattern) => ({
        [tool.filter]: pattern, patternMode: "regex",
      })),
      ...[null, true, 1, "REGEX", "glob"].map((patternMode) => ({
        [tool.filter]: "a", patternMode,
      })),
      { [tool.filter]: "a", patternMode: "regex", flags: "i" },
    ];
    for (const args of invalid) {
      const result = await client.callTool({
        name: tool.name, arguments: { tabId: 1, ...args },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toEqual([]);
  });
});
