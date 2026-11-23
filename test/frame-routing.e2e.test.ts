import { afterEach, describe, expect, it } from "vitest";
import { PreparedFileInputInputSchema } from "@mie/tool-defs/schemas";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const routes = [
  { name: "read_page", args: { tabId: 1 }, defaults: { maxChars: 50_000 } },
  { name: "find", args: { tabId: 1, query: "Save" },
    defaults: { exact: false } },
  { name: "form_input", args: { tabId: 1, backendNodeId: 7, value: "value" },
    defaults: {} },
  { name: "set_input_files", args: { tabId: 1, backendNodeId: 7,
    files: ["/tmp/空 文件.txt"] }, defaults: {} },
  { name: "computer", args: { tabId: 1, action: "click", backendNodeId: 7 },
    defaults: {} },
  { name: "computer", args: { tabId: 1, action: "type", backendNodeId: 7,
    text: "x" }, defaults: {} },
] as const;

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start({
    ...options, hello: { tool_defs_version: EXPECTED_TOOL_DEFS_VERSION },
  });
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

describe.each(routes)("$name frame routing over MCP stdio", (tool) => {
  it("keeps absent frame IDs absent and explicit IDs unchanged", async () => {
    const { bridge, client } = await start();
    const calls = [undefined, "F", "Frame.Mixed 空", "f".repeat(256)].map(
      (frameId) => ({ ...tool.args,
        ...(frameId === undefined ? {} : { frameId }) }),
    );
    for (const args of calls) {
      const result = await client.callTool({ name: tool.name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ ...tool.defaults, ...args });
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(
      calls.map((args) => ({ ...tool.defaults, ...args })),
    );
  });

  it("rejects malformed frame IDs before connecting", async () => {
    const { bridge, client } = await start();
    for (const frameId of ["", "f".repeat(257), 1, null, [], {}]) {
      const result = await client.callTool({
        name: tool.name, arguments: { ...tool.args, frameId },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toEqual([]);
  });

  it("does not retry a stale frame against the root", async () => {
    const error = { code: "TOOL_ERROR", message: "Frame is no longer available." };
    const { bridge, client } = await start({
      responses: [{ kind: "error", error }],
    });
    const result = await client.callTool({
      name: tool.name, arguments: { ...tool.args, frameId: "stale" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toMatchObject({ frameId: "stale" });
  });
});

describe("frame selection boundaries", () => {
  it("rejects non-element computer actions and unrelated tools", async () => {
    const { bridge, client } = await start();
    const actions = [
      { action: "screenshot" }, { action: "click" },
      { action: "click", coordinate: [0, 0] },
      { action: "click", coordinate: [0, 0], backendNodeId: 7 },
      { action: "type", text: "x" },
      { action: "type", text: "x", backendNodeId: 7, coordinate: [0, 0] },
      { action: "key", key: "Enter" },
      { action: "scroll", direction: "down", distance: 10 },
      { action: "wait", milliseconds: 0 },
    ];
    const calls = [
      ...actions.map((args) => ({ name: "computer", args })),
      { name: "get_page_text", args: { includeFrames: true } },
      { name: "read_network_request", args: { requestId: "r" } },
      { name: "read_console_messages", args: {} },
      { name: "read_network_requests", args: {} },
    ];
    for (const { name, args } of calls) {
      const result = await client.callTool({
        name, arguments: { tabId: 1, frameId: "child", ...args },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toEqual([]);
  });

  it("retains frameId in prepared input but rejects public verifiedFiles", async () => {
    const { bridge, client } = await start();
    const args = { tabId: 1, frameId: "Child.Mixed", backendNodeId: 7,
      files: ["/tmp/空 文件.txt"] };
    const prepared = { ...args, verifiedFiles: [{ name: "空 文件.txt", size: 0 }] };
    expect(PreparedFileInputInputSchema.parse(prepared)).toEqual(prepared);
    const forged = await client.callTool({
      name: "set_input_files", arguments: prepared,
    });
    expect(forged.isError).toBe(true);
    expect(forged.structuredContent).toMatchObject({
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(bridge.connectionCount).toBe(0);
    const result = await client.callTool({ name: "set_input_files", arguments: args });
    expect(result.isError).not.toBe(true);
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual([args]);
  });
});
