import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "observation_history";
const captureId = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
const recordId = "11111111-1111-4111-8111-111111111111";
const state = {
  enabled: true, count: 1, dropped: 0, bytes: 400,
  maxRecords: 1000, maxBytes: 2_000_000, pendingWrite: false,
  error: null, scope: "Local historical snapshots, not live eligibility.",
};

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

describe("observation history over MCP stdio", () => {
  it("lists a flat action schema without a wire limit default", async () => {
    const { client } = await start();
    const tool = (await client.listTools()).tools.find((tool) => tool.name === name);
    expect(tool?.inputSchema).toMatchObject({
      type: "object", required: ["action"], additionalProperties: false,
      properties: {
        action: { enum: ["status", "configure", "read", "clear"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    });
    expect(tool?.inputSchema).not.toHaveProperty("anyOf");
    expect(tool?.inputSchema.properties?.["limit"]).not.toHaveProperty("default");
  });

  it("forwards all action arguments without injecting read defaults", async () => {
    const { bridge, client } = await start();
    const calls = [
      { action: "status" }, { action: "clear" },
      { action: "configure", enabled: true },
      { action: "configure", enabled: false },
      { action: "read" },
      { action: "read", tabId: 99, captureId, kind: "console",
        beforeId: recordId, limit: 1 },
      { action: "read", kind: "network", limit: 200 },
    ];
    for (const args of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid action combinations before connecting", async () => {
    const { bridge, client } = await start();
    const query = { tabId: 1, captureId, kind: "console", beforeId: recordId, limit: 1 };
    const invalid = [
      {}, { action: "unknown" }, { action: 1 }, { action: "configure" },
      ...["true", 1, null].map((enabled) => ({ action: "configure", enabled })),
      ...["status", "clear", "read"].map((action) => ({ action, enabled: false })),
      ...["status", "clear", "configure"].flatMap((action) =>
        Object.entries(query).map(([key, value]) => ({
          action, ...(action === "configure" ? { enabled: false } : {}),
          [key]: value,
        }))),
      ...[0, -1, 1.5, "1"].map((tabId) => ({ action: "read", tabId })),
      ...[0, 201, 1.5, "100", null].map((limit) => ({ action: "read", limit })),
      ...["", "not-a-uuid", 1, null].flatMap((value) => [
        { action: "read", captureId: value }, { action: "read", beforeId: value },
      ]),
      { action: "read", kind: "all" }, { action: "read", extra: true },
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

  it.each([null, "History load failed. Clear history to recover."])(
    "preserves status error=%s as normal state", async (error) => {
      const payload = { content: JSON.stringify({ ...state, error, pendingWrite: true }) };
      const { client } = await start({ responses: [{ kind: "success", payload }] });
      const result = await client.callTool({ name, arguments: { action: "status" } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    },
  );

  it("preserves historical records and cursors without live follow-up calls", async () => {
    const payload = {
      content: JSON.stringify({ ...state, count: 2, records: [{
        id: recordId, captureId, tabId: 99, kind: "console", capturedAt: 1234,
        entry: { level: "log", text: "Saved 中文", url: "https://example.test/path",
          receivedAt: 1230 },
      }], nextCursor: recordId, omitted: 1 }),
    };
    const { bridge, client } = await start({ responses: [{ kind: "success", payload }] });
    const args = { action: "read", tabId: 99, captureId, limit: 1 };
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.tool).toBe(name);
  });

  it.each(["read", "configure", "clear"])(
    "preserves %s failure without retry", async (action) => {
      const error = { code: "TOOL_ERROR", message: "History write failed." };
      const { bridge, client } = await start({ responses: [{ kind: "error", error }] });
      const result = await client.callTool({
        name, arguments: { action, ...(action === "configure" ? { enabled: true } : {}) },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error });
      expect(bridge.receivedRequests).toHaveLength(1);
    },
  );
});
