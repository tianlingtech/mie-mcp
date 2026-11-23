import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];
const request = { tabId: 1, expectedOrigin: "https://example.com",
  url: "/fixture", responseBodyFormat: "hashOnly" };
const MAX_HASH_BYTES = 64 * 1024 * 1024;

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

describe("hash-only request contracts over MCP stdio", () => {
  it("lists hashOnly and its byte limit without changing the default", async () => {
    const { client } = await start();
    const { tools } = await client.listTools();
    const schema = tools.find(({ name }) => name === "request")?.inputSchema;
    expect(schema?.properties).toMatchObject({
      responseBodyFormat: { enum: ["text", "binary", "hashOnly"] },
      maxBytes: { minimum: 1, maximum: MAX_HASH_BYTES, default: 20_000 },
      timeoutMs: { maximum: 15_000, default: 10_000 },
    });
  });

  it.each([
    [0, 200, "GET"], [0, 200, "HEAD"],
    [50_001, 200, "GET"], [3_300_000, 200, "GET"], [128, 206, "GET"],
  ])("preserves EOF summary for %i bytes, status %i, %s",
    async (length, status, method) => {
      const summary = { status, headers: {}, method, responseBodyFormat: "hashOnly",
        bytesRead: length, complete: true, termination: "eof",
        sha256: createHash("sha256").update(Buffer.alloc(length, 0xab)).digest("hex"),
      };
      const payload = { content: JSON.stringify(summary) };
      const { bridge, client } = await start({
        responses: [{ kind: "success", payload }],
      });
      const maxBytes = Math.max(1, length);
      const result = await client.callTool({ name: "request", arguments: {
        ...request, method, maxBytes,
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
      expect(bridge.receivedRequests).toHaveLength(1);
      expect(bridge.receivedRequests[0]?.args).toEqual({
        ...request, method, maxBytes, allowWrite: false, timeoutMs: 10_000,
      });
    },
  );

  it.each(["byte-limit", "timeout", "read-error"])(
    "preserves incomplete %s summary without retry", async (termination) => {
      const payload = { content: JSON.stringify({
        status: 200, headers: {}, method: "GET", responseBodyFormat: "hashOnly",
        bytesRead: 20_000, complete: false, sha256: null, termination,
      }) };
      const { bridge, client } = await start({
        responses: [{ kind: "success", payload }],
      });
      const result = await client.callTool({ name: "request", arguments: request });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
      expect(bridge.receivedRequests).toHaveLength(1);
    },
  );

  it("forwards the largest bounds and authorized writes exactly once", async () => {
    const { bridge, client } = await start();
    for (const args of [request,
      { ...request, maxBytes: MAX_HASH_BYTES, timeoutMs: 15_000 },
      { ...request, method: "POST", allowWrite: true,
        body: "fixture", contentType: "text/plain" },
    ]) {
      expect((await client.callTool({ name: "request", arguments: args }))
        .isError).not.toBe(true);
      expect(bridge.receivedRequests.at(-1)?.args).toEqual({
        method: "GET", allowWrite: false, maxBytes: 20_000,
        timeoutMs: 10_000, ...args,
      });
    }
    expect(bridge.receivedRequests).toHaveLength(3);
  });

  it("enforces mode-specific limits and existing request boundaries locally", async () => {
    const { bridge, client } = await start();
    for (const extra of [
      { maxBytes: 0 }, { maxBytes: 1.5 }, { maxBytes: MAX_HASH_BYTES + 1 },
      { timeoutMs: 15_001 }, { timeoutMs: 0 }, { prefixBytes: 0 },
      { responseBodyFormat: "text", maxBytes: 50_001 },
      { responseBodyFormat: "binary", maxBytes: 50_001 },
      { responseBodyFormat: undefined, maxBytes: 50_001 },
      { url: "https://other.example/fixture" },
      { expectedOrigin: "https://example.com/path" },
      { method: "POST" }, { method: "POST", allowWrite: false },
      { method: "GET", body: "fixture", contentType: "text/plain" },
      { method: "HEAD", body: "fixture", contentType: "text/plain" },
      { method: "POST", allowWrite: true, body: "fixture" },
    ]) {
      expect((await client.callTool({ name: "request", arguments: {
        ...request, ...extra,
      } })).structuredContent).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect(bridge.connectionCount).toBe(0);
  });

  it("preserves opaque redirect results in hashOnly mode", async () => {
    const payload = { content: JSON.stringify({ code: "REDIRECT_NOT_FOLLOWED",
      status: null, location: null, redirectFollowed: false,
      detailsUnavailable: "opaque-redirect", method: "GET" }) };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const result = await client.callTool({ name: "request", arguments: request });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(bridge.receivedRequests).toHaveLength(1);
  });
});
