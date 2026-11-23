import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];

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

const source = {
  sessionId: "Child.Mixed", targetId: "target-1",
  targetType: "worker", parentSessionId: null,
};

describe.each(["read_console_messages", "read_network_requests"])(
  "%s child observation over MCP stdio", (name) => {
    it("preserves readiness errors as successful payload data", async () => {
      const payload = {
        content: JSON.stringify({
          entries: [{ requestId: "same-id", text: "child", source }],
          dropped: 2, invalidEvents: 1, omitted: 3, scope: "Associated sessions",
          subSessions: {
            active: 1, truncated: true,
            errors: [{ operation: "Network.enable", message: "Not ready.",
              sessionId: "Other.Child" }],
          },
        }),
      };
      const { bridge, client } = await start({
        responses: [{ kind: "success", payload }],
      });
      const result = await client.callTool({
        name, arguments: { tabId: 1, includeSubSessions: true, clear: true },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
      expect(bridge.receivedRequests[0]?.args).toEqual({
        tabId: 1, limit: 100, clear: true, includeSubSessions: true,
        ...(name === "read_console_messages" ? { onlyErrors: false } : {}),
      });
    });
  },
);

describe("network detail session selection over MCP stdio", () => {
  it("preserves absent and explicit session IDs for the same request ID", async () => {
    const calls = [undefined, "s", "Child.Mixed", "s".repeat(1024)].map(
      (sessionId) => ({
        tabId: 1, requestId: "same-id", maxChars: 20_000, includeBody: true,
        includeRequestBody: false, includeHeaders: true,
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    );
    const payloads = calls.map((args) => ({
      content: JSON.stringify({
        scope: "Associated session",
        requestHeaders: { values: {}, omitted: 0, redacted: 0, truncated: false },
        responseHeaders: { values: {}, omitted: 0, redacted: 0, truncated: false },
        request: { requestId: args.requestId,
          ...(args.sessionId === undefined ? {} : {
            source: { ...source, sessionId: args.sessionId },
          }) },
        body: { state: "available", text: args.sessionId ?? "root",
          redacted: false, truncated: false },
      }),
    }));
    const { bridge, client } = await start({
      responses: payloads.map((payload) => ({ kind: "success", payload })),
    });
    for (const [index, args] of calls.entries()) {
      const result = await client.callTool({
        name: "read_network_request", arguments: args,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payloads[index]);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payloads[index]) },
      ]);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("does not retry a rejected child request against the root session", async () => {
    const error = { code: "TOOL_ERROR", message: "Child association expired." };
    const { bridge, client } = await start({
      responses: [{ kind: "error", error }],
    });
    const result = await client.callTool({
      name: "read_network_request",
      arguments: { tabId: 1, requestId: "same-id", sessionId: "Child.Mixed" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toMatchObject({
      requestId: "same-id", sessionId: "Child.Mixed",
    });
  });
});
