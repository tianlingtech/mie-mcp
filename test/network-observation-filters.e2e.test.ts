import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];
const defaults = { limit: 100, clear: false, includeSubSessions: false };
const states = ["pending", "redirected", "finished", "failed"];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start({ ...options,
    hello: { tool_defs_version: EXPECTED_TOOL_DEFS_VERSION },
  });
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, client: harness.client };
}

describe("network observation filters over MCP stdio", () => {
  it("lists bounded optional filters without changing the tool count", async () => {
    const { client } = await start();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(25);
    const network = tools.find(({ name }) => name === "read_network_requests");
    expect(network?.inputSchema.properties).toMatchObject({
      excludeExtensions: { type: "boolean" },
      excludeDataUrls: { type: "boolean" },
      states: { type: "array", minItems: 1, maxItems: 4,
        items: { type: "string", enum: states } },
    });
    expect(network?.inputSchema.required).toEqual(["tabId"]);
  });

  it.each([{}, { excludeExtensions: false, excludeDataUrls: false }])(
    "preserves absent and explicit false filters %#", async (extra) => {
      const { bridge, client } = await start();
      const result = await client.callTool({ name: "read_network_requests",
        arguments: { tabId: 1, ...extra } });
      expect(result.isError).not.toBe(true);
      expect(bridge.receivedRequests[0]?.args).toEqual({
        tabId: 1, ...defaults, ...extra,
      });
    },
  );

  it("forwards each state and combined filters without rewriting", async () => {
    const { bridge, client } = await start();
    for (const selected of [...states.map((state) => [state]), states]) {
      const args = { tabId: 1, states: selected,
        excludeExtensions: true, excludeDataUrls: true, urlPattern: "api/.*",
        patternMode: "regex", limit: 1, clear: true, includeSubSessions: true };
      const result = await client.callTool({
        name: "read_network_requests", arguments: args,
      });
      expect(result.isError).not.toBe(true);
      expect(bridge.receivedRequests.at(-1)?.args).toEqual(args);
    }
    expect(bridge.receivedRequests).toHaveLength(5);
  });

  it("preserves filtered entries and child-session diagnostics", async () => {
    const payload = { content: JSON.stringify({ entries: [{ requestId: "one",
      url: "https://example.test/api", state: "failed",
      source: { sessionId: "child", targetId: "frame", targetType: "iframe",
        parentSessionId: null } }], dropped: 2, invalidEvents: 1, omitted: 3,
      scope: "Associated sessions", subSessions: { active: 1, truncated: false,
        errors: [{ operation: "Network.enable", message: "Not ready." }] },
    }) };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const result = await client.callTool({ name: "read_network_requests",
      arguments: { tabId: 1, states: ["failed"], includeSubSessions: true },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
  });

  it("rejects invalid filters and use on console before connecting", async () => {
    const { bridge, client } = await start();
    for (const extra of [
      { states: [] }, { states: [...states, "pending"] }, { states: "pending" },
      { states: ["Pending"] }, { states: ["unknown"] }, { states: [null] },
      { states: null }, { excludeExtensions: "true" }, { excludeExtensions: 1 },
      { excludeDataUrls: "false" }, { excludeDataUrls: null },
    ]) {
      const result = await client.callTool({ name: "read_network_requests",
        arguments: { tabId: 1, ...extra } });
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    for (const extra of [{ states: ["pending"] }, { excludeDataUrls: true }]) {
      const result = await client.callTool({ name: "read_console_messages",
        arguments: { tabId: 1, ...extra } });
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
    expect(bridge.receivedRequests).toHaveLength(0);
  });
});

describe("network idle timeout diagnostics over MCP stdio", () => {
  it.each([0, 1, 10])("preserves %i pending summaries and omission counts",
    async (count) => {
      const actual = { inflight: count === 10 ? 13 : count, idleForMs: 0,
        pendingRequests: Array.from({ length: count }, (_, i) => ({
          url: `https://example.test/${i}/`.padEnd(512, "x"), urlTruncated: true,
          type: i === 0 ? "unknown" : "Fetch".padEnd(64, "x"),
          typeTruncated: i !== 0,
          startedAt: 1_790_000_000_000 + i, elapsedMs: 2000 - i,
        })), pendingRequestsOmitted: count === 10 ? 3 : 0 };
      const payload = { content: JSON.stringify({ matched: false,
        timedOut: true, elapsedMs: 2000, actual }) };
      const { bridge, client } = await start({
        responses: [{ kind: "success", payload }],
      });
      const args = { tabId: 1, state: "network_idle", timeoutMs: 2000,
        excludeResourceTypes: ["Media"], excludeUrlPatterns: ["/ignored"] };
      const result = await client.callTool({ name: "wait_for", arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
      expect(bridge.receivedRequests[0]?.args).toEqual(args);
    },
  );

  it.each([
    { matched: true, timedOut: false, elapsedMs: 500,
      actual: { inflight: 0, idleForMs: 500 } },
    { matched: false, timedOut: true, elapsedMs: 0, actual: { pending: true } },
    { matched: false, timedOut: true, elapsedMs: 500,
      actual: { inflight: 1, idleForMs: 0 } },
  ])("does not fabricate diagnostics for legacy or pending responses %#",
    async (response) => {
      const payload = { content: JSON.stringify(response) };
      const { client } = await start({ responses: [{ kind: "success", payload }] });
      const result = await client.callTool({ name: "wait_for",
        arguments: { tabId: 1, state: "network_idle", timeoutMs: 500 } });
      expect(result.structuredContent).toEqual(payload);
    },
  );
});
