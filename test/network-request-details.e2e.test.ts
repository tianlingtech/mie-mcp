import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "read_network_request";
const required = { tabId: 1, requestId: "req.1" };

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

describe("network request details over MCP stdio", () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("forwards independent response/request body switches %s/%s", async (
    includeBody, includeRequestBody,
  ) => {
    const args = { ...required, sessionId: "Child.Mixed", maxChars: 1,
      includeBody, includeRequestBody, includeHeaders: true };
    const { bridge, client } = await start();
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual([args]);
  });

  it.each(["pending", "available", "unavailable"])(
    "preserves request data and ExtraInfo metadata in state %s", async (extraInfo) => {
      const headers = { values: { "x-test": "Mixed" }, omitted: 2, redacted: 1,
        truncated: true, source: extraInfo === "available" ? "extra-info" : "base",
        extraInfo };
      const payload = { content: JSON.stringify({
        scope: "Latest redirect hop.", request: { requestId: required.requestId },
        requestHeaders: headers, responseHeaders: { ...headers, statusCode: 304 },
        body: { state: "omitted" },
        requestBody: { state: "available", text: "空=值&token=[REDACTED]",
          source: "Network.getRequestPostData", truncated: false, redacted: true },
      }) };
      const { client } = await start({ responses: [{ kind: "success", payload }] });
      const result = await client.callTool({ name, arguments: {
        ...required, includeBody: false, includeRequestBody: true,
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
    },
  );

  it("injects shared defaults before sending the request", async () => {
    const { bridge, client } = await start();
    const result = await client.callTool({ name, arguments: required });
    const args = { ...required, maxChars: 20_000, includeBody: true,
      includeRequestBody: false, includeHeaders: true };

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(args);
    expect(bridge.receivedRequests).toEqual([
      expect.objectContaining({ type: "tool_request", tool: name, args }),
    ]);
  });

  it("preserves an absent request body without manufacturing empty text", async () => {
    const payload = { content: JSON.stringify({
      request: { requestId: required.requestId }, body: { state: "omitted" },
      requestBody: { state: "absent" },
    }) };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name, arguments: {
      ...required, includeRequestBody: true, includeBody: false,
    } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it("preserves explicit input boundaries and headers-only mode", async () => {
    const { bridge, client } = await start();
    const calls = [
      { tabId: 1, requestId: "r", maxChars: 1, includeBody: false,
        includeRequestBody: false, includeHeaders: true },
      {
        tabId: 2,
        requestId: "R".repeat(1024),
        maxChars: 50_000,
        includeBody: true,
        includeRequestBody: false,
        includeHeaders: false,
      },
    ];

    for (const args of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid inputs before connecting to the bridge", async () => {
    const { bridge, client } = await start();
    const invalid = [
      {},
      { tabId: 1 },
      { requestId: "r" },
      ...[0, -1, 1.5, "1", null].map((tabId) => ({ ...required, tabId })),
      ...["", "r".repeat(1025), 1, null].map((requestId) => ({
        ...required, requestId,
      })),
      ...[0, -1, 50_001, 1.5, "20000", null].map((maxChars) => ({
        ...required, maxChars,
      })),
      ...["false", 0, null].map((includeBody) => ({ ...required, includeBody })),
      ...["true", 1, null].map((includeRequestBody) => ({
        ...required, includeRequestBody,
      })),
      ...["", "s".repeat(1025), 1, null].map((sessionId) => ({
        ...required, sessionId,
      })),
      { ...required, includeSubSessions: true },
      { ...required, unexpected: true },
      { ...required, clear: true },
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

  it.each([true, false])("preserves the payload with includeBody=%s", async (
    includeBody,
  ) => {
    const payload = {
      content: JSON.stringify({
        scope: "Main session; headers from base CDP events.",
        request: { requestId: "req.1", status: 404 },
        requestHeaders: {
          values: { Authorization: "[REDACTED]" },
          omitted: 0, redacted: 1, truncated: false,
        },
        responseHeaders: {
          values: { "content-type": "application/json" },
          omitted: 0, redacted: 0, truncated: false,
        },
        body: includeBody
          ? {
            state: "available", text: "{\"value\":\"MiXeD\\n中文\"}",
            truncated: true, redacted: true,
          }
          : { state: "omitted" },
      }),
    };
    const { client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const result = await client.callTool({
      name, arguments: { ...required, includeBody },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(payload) },
    ]);
  });

  it.each([false, true])("preserves failures with includeRequestBody=%s", async (
    includeRequestBody,
  ) => {
    const error = {
      code: "TOOL_ERROR",
      message: "Response body is unavailable.",
      data: { reason: "expired" },
    };
    const { client, bridge } = await start({
      responses: [{ kind: "error", error }],
    });
    const result = await client.callTool({ name, arguments: {
      ...required, includeRequestBody,
    } });

    expect(result.isError).toBe(true);
    const expectedError = {
      code: error.code,
      message: error.message,
      hint: "工具执行失败, 具体原因和处理建议见 message",
      data: error,
    };
    expect(result.structuredContent).toEqual({ error: expectedError });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(expectedError),
      },
    ]);
    expect(bridge.receivedRequests).toHaveLength(1);
  });
});
