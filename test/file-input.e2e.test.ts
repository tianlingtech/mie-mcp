import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "set_input_files";
const ids = { tabId: 1, backendNodeId: 7 };

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

describe("file inputs over MCP stdio", () => {
  it("preserves empty, single and multiple path arrays without enrichment", async () => {
    const { bridge, client } = await start();
    const paths = [
      [],
      ["/tmp/mie-file-input/空 文件.txt"],
      ["/tmp/mie-file-input/b.txt", "/tmp/mie-file-input/a.txt",
        "/tmp/mie-file-input/b.txt"],
      ["C:\\temp\\fixture.txt", "D:/temp/fixture.txt",
        "\\\\server\\share\\fixture.txt"],
      ["/" + "x".repeat(4095)],
      Array.from({ length: 10 }, (_, i) => `/tmp/mie-file-input/${i}.txt`),
    ];
    for (const files of paths) {
      const args = { ...ids, files };
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(
      paths.map((files) => ({ ...ids, files })),
    );
  });

  it("rejects malformed or forged inputs before connecting to the bridge", async () => {
    const { bridge, client } = await start();
    const invalid = [
      {}, ids,
      ...[undefined, 0, -1, 1.5, "1", null].flatMap((value) => [
        { ...ids, files: [], tabId: value },
        { ...ids, files: [], backendNodeId: value },
      ]),
      ...[null, "a", {}, [1], Array(11).fill("/tmp/a")].map((files) => ({
        ...ids, files,
      })),
      ...["", "relative.txt", "~/file", "C:relative.txt", "file:///tmp/a",
        "/tmp/a\0b", "/" + "x".repeat(4096)].map((path) => ({
        ...ids, files: [path],
      })),
      { ...ids, files: [], verifiedFiles: [] },
      { ...ids, files: [], unexpected: true },
    ];
    for (const args of invalid) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toEqual([]);
  });

  it.each([true, false])("preserves metadata when cleared=%s", async (cleared) => {
    const payload = {
      content: JSON.stringify({
        backendNodeId: ids.backendNodeId,
        files: cleared ? [] : [{
          name: "空 文件.txt", size: 0, type: "text/plain", lastModified: 1234,
        }],
        cleared,
      }),
    };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({
      name,
      arguments: { ...ids, files: cleared ? [] : ["/tmp/空 文件.txt"] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it.each([
    ["TOOL_ERROR", "File validation failed.", "工具执行失败, 具体原因和处理建议见 message"],
    ["TAB_GONE", "The target tab no longer exists.",
      "目标标签页已不存在, 请重新获取标签页上下文"],
    ["TIMEOUT", "File preflight timed out.",
      "请求超时, 请检查页面状态后再决定是否重试"],
  ])("preserves %s without retrying", async (code, message, hint) => {
    const error = { code, message };
    const { bridge, client } = await start({
      responses: [{ kind: "error", error }],
    });
    const result = await client.callTool({ name, arguments: { ...ids, files: [] } });
    const expected = { code, message, hint, data: error };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: expected });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expected) },
    ]);
    expect(bridge.receivedRequests).toHaveLength(1);
  });
});
