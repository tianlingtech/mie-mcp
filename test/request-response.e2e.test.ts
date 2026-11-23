import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];
const request = {
  tabId: 1, expectedOrigin: "https://example.com", url: "/fixture",
};

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start(options);
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

describe("request response contracts over MCP stdio", () => {
  it.each(["GET", "HEAD", "POST"])(
    "preserves redirect result for %s without retry", async (method) => {
      const payload = { content: JSON.stringify({ code: "REDIRECT_NOT_FOLLOWED",
        status: null, location: null, redirectFollowed: false,
        detailsUnavailable: "opaque-redirect", method }) };
      const { bridge, client } = await start({ responses: [{
        kind: "success", payload,
      }] });
      const result = await client.callTool({ name: "request", arguments: {
        ...request, method, ...(method === "POST" ? { allowWrite: true } : {}),
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
      expect(bridge.receivedRequests).toHaveLength(1);
    },
  );

  it.each([false, true])("preserves binary summary, truncated=%s", async (truncated) => {
    const bytes = Buffer.from([0, 128, 255]);
    const summary = { status: 200, headers: {}, responseBodyFormat: "binary",
      bytesRead: bytes.length, truncated,
      sha256: truncated ? null : createHash("sha256").update(bytes).digest("hex"),
      prefixHex: "0080", prefixBytes: 2, method: "GET",
      redactionScope: "headers-only; binary-prefix-not-redacted" };
    const payload = { content: JSON.stringify(summary) };
    const maxBytes = truncated ? 3 : 4;
    const { bridge, client } = await start({ responses: [
      { kind: "success", payload },
    ] });
    const result = await client.callTool({ name: "request", arguments: {
      ...request, responseBodyFormat: "binary", prefixBytes: 2, maxBytes,
    } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toMatchObject({
      responseBodyFormat: "binary", prefixBytes: 2, maxBytes,
    });
  });

  it.each(["GET", "HEAD", "POST"])(
    "preserves %s failure wording and does not retry", async (method) => {
      const message = "REQUEST_TIMEOUT. Request timed out. No automatic retry"
        + (method === "POST"
          ? "; the server may have received the write request." : ".");
      const { bridge, client } = await start({ responses: [{
        kind: "error", error: { code: "TOOL_ERROR", message },
      }] });
      const result = await client.callTool({ name: "request", arguments: {
        ...request, method, ...(method === "POST" ? { allowWrite: true } : {}),
      } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "TOOL_ERROR", message },
      });
      expect(bridge.receivedRequests).toHaveLength(1);
    },
  );

  it("rejects invalid binary parameters before connecting", async () => {
    const { bridge, client } = await start();
    for (const extra of [
      { prefixBytes: 1 }, { responseBodyFormat: "text", prefixBytes: 0 },
      { responseBodyFormat: "binary", prefixBytes: -1 },
      { responseBodyFormat: "binary", prefixBytes: 257 },
      { responseBodyFormat: "binary", prefixBytes: 0.5 },
      { responseBodyFormat: "base64" },
      { responseBodyFormat: "binary", maxBytes: 50_001 },
    ]) {
      expect((await client.callTool({ name: "request", arguments: {
        ...request, ...extra,
      } })).structuredContent).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect(bridge.connectionCount).toBe(0);
  });

  it("preserves existing text output when format is omitted", async () => {
    const payload = { content: JSON.stringify({
      status: 200, headers: {}, body: "fixture", bytesRead: 7, truncated: false,
    }) };
    const { bridge, client } = await start({ responses: [
      { kind: "success", payload },
    ] });
    const result = await client.callTool({ name: "request", arguments: request });
    expect(result.structuredContent).toEqual(payload);
    expect(bridge.receivedRequests[0]?.args).toMatchObject({
      ...request, method: "GET", allowWrite: false,
      timeoutMs: 10_000, maxBytes: 20_000,
    });
  });
});
