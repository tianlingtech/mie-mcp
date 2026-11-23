import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "read_network_request";
const required = { tabId: 1, requestId: "req.formats" };
const formats = ["text", "base64", "multipart"] as const;

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start({ ...options,
    hello: { tool_defs_version: EXPECTED_TOOL_DEFS_VERSION } });
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

describe("request body formats over MCP stdio", () => {
  it.each(formats)("forwards explicit %s and independent response switch", async (
    requestBodyFormat,
  ) => {
    const { bridge, client } = await start();
    const calls = [false, true].map((includeBody) => ({
      ...required, requestBodyFormat, includeRequestBody: true, includeBody,
      sessionId: "Child.Mixed", maxChars: 1, includeHeaders: true,
    }));
    for (const args of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("keeps omitted format absent for either request body switch", async () => {
    const { bridge, client } = await start();
    for (const includeRequestBody of [false, true]) {
      const result = await client.callTool({ name, arguments: {
        ...required, includeRequestBody,
      } });
      expect(result.structuredContent).toEqual({ ...required,
        includeRequestBody, includeBody: true, maxChars: 20_000,
        includeHeaders: true });
    }
    expect(bridge.receivedRequests).toHaveLength(2);
    for (const request of bridge.receivedRequests) {
      expect(request.args).not.toHaveProperty("requestBodyFormat");
    }
  });

  it("rejects invalid formats and disabled body combinations before connecting",
    async () => {
      const { bridge, client } = await start();
      const invalid = [
        ...formats.flatMap((requestBodyFormat) => [
          { ...required, requestBodyFormat },
          { ...required, requestBodyFormat, includeRequestBody: false },
        ]),
        ...["", "TEXT", "binary", 1, null, [], {}].map((requestBodyFormat) => ({
          ...required, requestBodyFormat, includeRequestBody: true,
        })),
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

  it.each(["base64", "utf8", "legacy-utf8"])(
    "preserves binary bytes and %s provenance without decoding", async (
      encodingSource,
    ) => {
      const requestBody = { state: "available", format: "base64",
        data: "AP+A", byteLength: 8, returnedBytes: 3, truncated: true,
        redacted: false, source: "Network.getRequestPostData",
        encodingSource, completeness: "unknown" };
      const payload = { content: JSON.stringify({ requestBody }) };
      const { client } = await start({ responses: [{ kind: "success", payload }] });
      const result = await client.callTool({ name, arguments: {
        ...required, includeRequestBody: true, requestBodyFormat: "base64",
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
    },
  );

  it("preserves ordered duplicate fields, file metadata and omitted counts",
    async () => {
      const requestBody = { state: "available", format: "multipart",
        source: "Network.getRequestPostData", partial: true, filesOmitted: true,
        omittedParts: 2, truncated: true, redacted: true, parts: [
          { kind: "field", name: "重复", value: "first", truncated: false },
          { kind: "file", name: "upload", filename: "报告.bin",
            mimeType: "application/octet-stream", omitted: true },
          { kind: "field", name: "重复", value: "", truncated: true },
          { kind: "field", name: "token", value: "[REDACTED]", truncated: false },
        ] };
      const payload = { content: JSON.stringify({ requestBody }) };
      const { client } = await start({ responses: [{ kind: "success", payload }] });
      const result = await client.callTool({ name, arguments: {
        ...required, includeRequestBody: true, requestBodyFormat: "multipart",
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
    });

  it.each(formats)("preserves absent body for %s", async (requestBodyFormat) => {
    const payload = { content: JSON.stringify({ requestBody: { state: "absent" } }) };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name, arguments: {
      ...required, includeRequestBody: true, requestBodyFormat,
    } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it.each(formats)("preserves %s failure without fallback or retry", async (
    requestBodyFormat,
  ) => {
    const error = { code: "TOOL_ERROR", message: "Request body is unavailable.",
      data: { reason: "unsupported-format" } };
    const { bridge, client } = await start({
      responses: [{ kind: "error", error }],
    });
    const result = await client.callTool({ name, arguments: {
      ...required, includeRequestBody: true, requestBodyFormat,
    } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: {
      code: error.code, message: error.message, data: error,
    } });
    expect(result.content).toEqual([{ type: "text",
      text: JSON.stringify((result.structuredContent as { error: unknown }).error) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
  });
});
