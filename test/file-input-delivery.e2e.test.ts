import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];
const name = "set_input_files";
const file = { name: "空 文件.txt", size: 0, type: "text/plain", lastModified: 1234 };
const input = { tabId: 1, backendNodeId: 7, files: ["/tmp/空 文件.txt"] };

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0]) {
  const bridge = await FakeBridge.start({ ...options,
    hello: { tool_defs_version: EXPECTED_TOOL_DEFS_VERSION },
  });
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

describe("file delivery evidence over MCP stdio", () => {
  it.each([
    { verification: "current-state", inputState: "retained", cleared: false },
    { verification: "trusted-event", inputState: "cleared", cleared: false },
    { verification: "trusted-event", inputState: "removed", cleared: false },
    { verification: "trusted-event", inputState: "changed", cleared: false },
    { verification: "current-state", inputState: "cleared", cleared: true },
    { verification: "trusted-event", inputState: "changed", cleared: false,
      observationError: "Unable to inspect file metadata during the trusted event." },
  ])("preserves evidence and requested clear semantics %#", async (evidence) => {
    const resultData = { backendNodeId: input.backendNodeId, frameId: "Child.Mixed",
      files: evidence.cleared ? [] : [file], ...evidence };
    const payload = { content: JSON.stringify(resultData) };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const args = { ...input, frameId: "Child.Mixed",
      files: evidence.cleared ? [] : input.files };
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toEqual(args);
  });

  it.each([
    "No matching delivery evidence.",
    "DOM.setFileInputFiles failed after dispatch.",
    "File event observation evaluation failed.",
    "File input cleanup failed.",
  ])("keeps uncertain outcome warnings without retrying: %s", async (detail) => {
    const message = "FILE_SELECTION_UNCONFIRMED. "
      + "The page may already have processed the selection. Inspect its state "
      + `before retrying; do not retry automatically. ${detail}`;
    const error = { code: "TOOL_ERROR", message };
    const { bridge, client } = await start({ responses: [{ kind: "error", error }] });
    const args = { ...input, frameId: "Child.Mixed" };
    const result = await client.callTool({ name, arguments: args });
    const expected = { code: "TOOL_ERROR", message,
      hint: "工具执行失败, 具体原因和处理建议见 message", data: error };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: expected });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toEqual(args);
  });
});
