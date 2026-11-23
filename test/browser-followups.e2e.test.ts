import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];
const idle = { tabId: 1, state: "network_idle", timeoutMs: 2000 };

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function connect(bridge: FakeBridge) {
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return harness.client;
}

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start(options);
  bridges.push(bridge);
  return { bridge, client: await connect(bridge) };
}

describe("network idle exclusions over MCP stdio", () => {
  it("lists bounded exclusion fields and the optional closed-tab query", async () => {
    const { client } = await start();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(25);
    const wait = tools.find(({ name }) => name === "wait_for");
    expect(wait?.inputSchema.properties).toMatchObject({
      excludeResourceTypes: {
        type: "array", maxItems: 20,
        items: { enum: expect.arrayContaining(["Media", "EventSource", "Fetch"]) },
      },
      excludeUrlPatterns: {
        type: "array", maxItems: 20,
        items: { type: "string", minLength: 1, maxLength: 1000 },
      },
    });
    expect(tools.find(({ name }) => name === "tabs_context")
      ?.inputSchema.properties?.includeClosed).toEqual({ type: "boolean" });
  });

  it.each([true, false])("preserves exclusions and matched=%s", async (matched) => {
    const payload = { content: JSON.stringify({
      matched, timedOut: !matched, elapsedMs: matched ? 500 : 2000,
      actual: matched ? { inflight: 0, idleForMs: 500 }
        : { inflight: 1, idleForMs: 0 },
    }) };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const args = { ...idle, idleMs: 500,
      excludeResourceTypes: ["Media", "EventSource"],
      excludeUrlPatterns: ["/Chat/Stream?", "*.literal", "/[literal]/"],
    };
    const result = await client.callTool({ name: "wait_for", arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toEqual(args);
  });

  it("does not add exclusions by default and accepts bounded lists", async () => {
    const { bridge, client } = await start();
    for (const args of [idle,
      { ...idle, excludeResourceTypes: [], excludeUrlPatterns: [] },
      { ...idle, excludeResourceTypes: Array(20).fill("Fetch"),
        excludeUrlPatterns: Array(20).fill("x".repeat(1000)) },
    ]) {
      expect((await client.callTool({ name: "wait_for", arguments: args }))
        .isError).not.toBe(true);
      expect(bridge.receivedRequests.at(-1)?.args).toEqual(args);
    }
    expect(bridge.receivedRequests).toHaveLength(3);
  });

  it("rejects invalid rules and rules on non-network waits before connection", async () => {
    const { bridge, client } = await start();
    for (const extra of [
      { excludeResourceTypes: ["fetch-stream"] },
      { excludeResourceTypes: ["media"] },
      { excludeResourceTypes: Array(21).fill("Media") },
      { excludeResourceTypes: "Media" },
      { excludeUrlPatterns: [""] },
      { excludeUrlPatterns: ["x".repeat(1001)] },
      { excludeUrlPatterns: Array(21).fill("/stream") },
      { excludeUrlPatterns: [1] },
      { state: "visible", selector: "#ready", excludeUrlPatterns: [] },
      { state: "url", expected: "/ready", excludeResourceTypes: [] },
    ]) {
      const result = await client.callTool({
        name: "wait_for", arguments: { ...idle, ...extra },
      });
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect(bridge.connectionCount).toBe(0);
  });
});

describe("closed-tab audit over MCP stdio", () => {
  it("attributes all closes to the caller's process across two clients", async () => {
    const { bridge, client } = await start();
    const second = await connect(bridge);
    const ids: string[] = [];
    for (const caller of [client, second]) {
      await caller.callTool({ name: "tabs_create", arguments: {} });
      const create = bridge.receivedRequests.at(-1)?.args as { sessionId: string };
      expect(create.sessionId).toEqual(expect.any(String));
      ids.push(create.sessionId);
      for (const args of [{ tabIds: [1] }, { tabIds: [1], mineOnly: false },
        { mineOnly: true }, { tabIds: [1, 2], mineOnly: true },
      ]) {
        const result = await caller.callTool({ name: "tabs_close", arguments: args });
        expect(result.isError).not.toBe(true);
        expect(bridge.receivedRequests.at(-1)?.args).toEqual({
          ...args, sessionId: create.sessionId,
        });
      }
      const result = await caller.callTool({ name: "tabs_context", arguments: {
        includeClosed: true, mineOnly: true,
      } });
      expect(result.isError).not.toBe(true);
      expect(bridge.receivedRequests.at(-1)?.args).toEqual({
        includeClosed: true, mineOnly: true, sessionId: create.sessionId,
      });
    }
    expect(new Set(ids).size).toBe(2);
    expect(bridge.receivedRequests).toHaveLength(12);
  });

  it("preserves independent remove results and observed close events", async () => {
    const common = { tabId: 1,
      ownerSessionId: randomUUID(), closerSessionId: randomUUID(), source: "mie",
      requestedAt: 1000, finishedAt: 1001, closedAt: null };
    const payload = { tabs: [], closedTabs: [
      { ...common, auditId: randomUUID(), result: "failed", closedAt: 1002 },
      { ...common, auditId: randomUUID(), result: "succeeded" },
      { ...common, auditId: randomUUID(), result: "requested", finishedAt: null },
      { ...common, auditId: randomUUID(), source: "unknown/external",
        closerSessionId: null, requestedAt: null, finishedAt: null,
        closedAt: 999, result: null },
    ] };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const result = await client.callTool({ name: "tabs_context", arguments: {
      includeClosed: true,
    } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests[0]?.args).toEqual({ includeClosed: true });
  });

  it("rejects invalid audit selectors and forged closer IDs locally", async () => {
    const { bridge, client } = await start();
    for (const [name, args] of [
      ["tabs_context", { includeClosed: "true" }],
      ["tabs_context", { includeClosed: true, sessionId: "forged" }],
      ["tabs_close", { tabIds: [1], sessionId: "forged" }],
      ["tabs_close", { tabIds: [1], mineOnly: false, sessionId: null }],
      ["tabs_close", {}],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).structuredContent)
        .toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect(bridge.connectionCount).toBe(0);
  });
});
