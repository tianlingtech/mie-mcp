import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "get_page_text";

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
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

describe("iframe page text over MCP stdio", () => {
  it("injects main-frame defaults for existing callers", async () => {
    const { bridge, client } = await start();
    for (const args of [{ tabId: 1 }, { tabId: 1, maxChars: 1000 }]) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        maxChars: 50_000, ...args, includeFrames: false,
      });
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual([
      { tabId: 1, maxChars: 50_000, includeFrames: false },
      { tabId: 1, maxChars: 1000, includeFrames: false },
    ]);
  });

  it("preserves explicit modes and character boundaries", async () => {
    const { bridge, client } = await start();
    const calls = [
      { tabId: 1, maxChars: 1000, includeFrames: false },
      { tabId: 2, maxChars: 200_000, includeFrames: true },
    ];
    for (const args of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid inputs and keeps read_page inputs unchanged", async () => {
    const { bridge, client } = await start();
    const invalid = [
      {},
      ...[0, -1, 1.5, "1"].map((tabId) => ({ tabId })),
      ...[999, 200_001, 1000.5, "50000", null].map((maxChars) => ({
        tabId: 1, maxChars,
      })),
      ...["false", 0, null].map((includeFrames) => ({ tabId: 1, includeFrames })),
      { tabId: 1, unknown: true },
    ];
    for (const args of invalid) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    for (const includeFrames of [true, false]) {
      const result = await client.callTool({
        name: "read_page", arguments: { tabId: 1, includeFrames },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toEqual([]);
  });

  it("preserves the old plain text response", async () => {
    const payload = {
      content: "Title: Example\nURL: https://example.com/\nSource: main\n\n正文",
    };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name, arguments: { tabId: 1 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it("preserves partial frame failures as a successful JSON text response", async () => {
    const frame = {
      frameId: "root", parentFrameId: null, title: "Main", url: "about:blank",
      sourceTag: "main", text: "正文: \"quoted\"\nnext", truncated: true,
    };
    const payload = {
      content: JSON.stringify({
        frames: [frame, {
          ...frame, frameId: "child", parentFrameId: "root", text: "",
          error: "Frame evaluation failed.",
        }],
        omitted: 2, truncated: true,
      }),
    };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({
      name, arguments: { tabId: 1, includeFrames: true },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it("preserves a root discovery failure as a tool error", async () => {
    const error = { code: "TOOL_ERROR", message: "Root DOM discovery failed." };
    const { client } = await start({ responses: [{ kind: "error", error }] });
    const result = await client.callTool({
      name, arguments: { tabId: 1, includeFrames: true },
    });
    const expected = {
      ...error, hint: "工具执行失败, 具体原因和处理建议见 message", data: error,
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: expected });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expected) },
    ]);
  });
});
