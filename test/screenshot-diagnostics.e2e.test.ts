import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge, type FakeBridgeOptions } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";
import { SCREENSHOT_PAYLOAD, JPEG_SCREENSHOT_PAYLOAD }
  from "./support/screenshot-fixture.js";

let bridge: FakeBridge | undefined;
let harness: McpHarness | undefined;
const diagnosticId = randomUUID();

afterEach(async () => {
  await harness?.close();
  await bridge?.stop();
  harness = undefined;
  bridge = undefined;
});

async function start(options: FakeBridgeOptions = {}) {
  bridge = await FakeBridge.start(options);
  harness = await startMcpClient(bridge.tempDirectory);
  return harness.client;
}

describe("screenshot diagnostic consumption over MCP stdio", () => {
  it("reads diagnostics with defaults without requiring a live tab", async () => {
    const payload = { content: JSON.stringify({ records: [], storage: "available" }) };
    const client = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name: "screenshot_diagnostics" });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge?.receivedRequests).toHaveLength(1);
    expect(bridge?.receivedRequests[0]).toMatchObject({
      tool: "screenshot_diagnostics", args: { action: "read" },
    });
  });

  it.each([1, 150])("passes ID and closed tab filters with limit %s", async (limit) => {
    const payload = { content: JSON.stringify({
      records: [{ diagnosticId, tabId: 7 }],
    }) };
    const client = await start({ responses: [{ kind: "success", payload }] });
    const args = { action: "read", diagnosticId, tabId: 7, limit };
    const result = await client.callTool({ name: "screenshot_diagnostics",
      arguments: args });
    expect(result.structuredContent).toEqual(payload);
    expect(bridge?.receivedRequests).toHaveLength(1);
    expect(bridge?.receivedRequests[0]?.args).toEqual(args);
  });

  it("passes clear without read filters or a session identifier", async () => {
    const payload = { content: JSON.stringify({ cleared: true }) };
    const client = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name: "screenshot_diagnostics",
      arguments: { action: "clear" } });
    expect(result.structuredContent).toEqual(payload);
    expect(bridge?.receivedRequests).toHaveLength(1);
    expect(bridge?.receivedRequests[0]?.args).toEqual({ action: "clear" });
  });

  it("rejects invalid filters before connecting", async () => {
    const client = await start();
    for (const args of [
      { action: "write" }, { diagnosticId: "not-a-uuid" }, { tabId: 0 },
      { limit: 0 }, { limit: 151 }, { limit: 1.5 }, { limit: "20" },
      { action: "clear", diagnosticId }, { action: "clear", tabId: 7 },
      { action: "clear", limit: 20 }, { action: "read", sessionId: "forged" },
    ]) {
      const result = await client.callTool({ name: "screenshot_diagnostics",
        arguments: args });
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge?.connectionCount).toBe(0);
  });

  it.each(["TIMEOUT", "TOOL_ERROR"])(
    "preserves screenshot failure %s and data without retry", async (code) => {
      const message = "Original screenshot failure message.";
      const data = { diagnosticId, originalDetail: "retained" };
      const client = await start({ responses: [{ kind: "error",
        error: { code, message, data } }] });
      const result = await client.callTool({ name: "computer",
        arguments: { tabId: 7, action: "screenshot" } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code, message, data: { code, message, data } },
      });
      expect(bridge?.receivedRequests).toHaveLength(1);
      expect(bridge?.receivedRequests[0]?.tool).toBe("computer");
    },
  );

  it("keeps old screenshot failures compatible without inventing an ID", async () => {
    const client = await start({ responses: [{ kind: "error",
      error: { code: "TIMEOUT", message: "Original timeout." } }] });
    const result = await client.callTool({ name: "computer",
      arguments: { tabId: 7, action: "screenshot" } });
    expect(result.structuredContent).toMatchObject({ error: {
      code: "TIMEOUT", message: "Original timeout.",
    } });
    expect(JSON.stringify(result.structuredContent)).not.toContain("diagnosticId");
  });

  it.each([
    [SCREENSHOT_PAYLOAD, "png", { diagnosticId, diagnosticStatus: "saved" }],
    [JPEG_SCREENSHOT_PAYLOAD, "jpeg", { diagnosticId, diagnosticStatus: "saved" }],
    [SCREENSHOT_PAYLOAD, "png", { diagnosticId, diagnosticStatus: "pending" }],
    [SCREENSHOT_PAYLOAD, "png", { diagnosticId, diagnosticStatus: "unavailable" }],
    [SCREENSHOT_PAYLOAD, "png", { diagnosticStatus: "unavailable" }],
  ] as const)("preserves native image and diagnostic metadata %#", async (image,
    format, metadata) => {
    const client = await start({ responses: [{ kind: "success", payload: {
      ...image, ...metadata, unexpected: "must not appear in metadata",
    } }] });
    const result = await client.callTool({ name: "computer",
      arguments: { tabId: 7, action: "screenshot", format } });
    const expected = { mimeType: image.mimeType, width: 1, height: 1, ...metadata };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([
      { type: "image", data: image.base64, mimeType: image.mimeType },
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
  });

  it.each([
    { diagnosticId: "https://private.invalid/", diagnosticStatus: "saved" },
    { diagnosticId }, { diagnosticStatus: "saved" },
    { diagnosticStatus: "pending" }, { diagnosticId, diagnosticStatus: "unknown" },
    { diagnosticId: null, diagnosticStatus: "unavailable" },
    { diagnosticId: {}, diagnosticStatus: { url: "must not appear" } },
  ])("does not let malformed diagnostic fields replace a valid image %#",
    async (metadata) => {
      const client = await start({ responses: [{ kind: "success",
        payload: { ...SCREENSHOT_PAYLOAD, ...metadata } }] });
      const result = await client.callTool({ name: "computer",
        arguments: { tabId: 7, action: "screenshot" } });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([{ type: "image",
        data: SCREENSHOT_PAYLOAD.base64, mimeType: SCREENSHOT_PAYLOAD.mimeType }]));
      expect(result.structuredContent).toEqual({ mimeType: "image/png",
        width: 1, height: 1, diagnosticStatus: "unavailable" });
    },
  );
});
