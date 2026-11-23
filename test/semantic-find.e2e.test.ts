import { afterEach, describe, expect, it } from "vitest";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "find";

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

describe("semantic find over MCP stdio", () => {
  it("lists a flat input schema with only tabId required", async () => {
    const { client } = await start();
    const tool = (await client.listTools()).tools.find((tool) => tool.name === name);
    expect(tool?.inputSchema).toMatchObject({
      type: "object", required: ["tabId"], additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        role: { type: "string", minLength: 1, maxLength: 100 },
        name: { type: "string", maxLength: 200 },
        exact: { type: "boolean", default: false },
      },
    });
    expect(tool?.inputSchema).not.toHaveProperty("anyOf");
  });

  it("injects exact=false for existing query-only callers", async () => {
    const { bridge, client } = await start();
    const result = await client.callTool({
      name, arguments: { tabId: 1, query: "Submit" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      tabId: 1, query: "Submit", exact: false,
    });
    expect(bridge.receivedRequests[0]?.args).toEqual(result.structuredContent);
  });

  it("preserves role, name, query and exact without normalization", async () => {
    const { bridge, client } = await start();
    const criteria = [
      { role: " BuTToN " }, { name: " Save\t draft " },
      { role: "button", name: "Save", exact: true },
      { query: " Sa ", role: " BUTTON ", name: " Save  draft ", exact: false },
      { name: "", exact: true }, { name: " \t\n ", exact: true },
      { role: "r".repeat(100), name: "n".repeat(200), query: "q".repeat(200) },
    ];
    for (const args of criteria) {
      const result = await client.callTool({ name, arguments: { tabId: 1, ...args } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ tabId: 1, exact: false, ...args });
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(
      criteria.map((args) => ({ tabId: 1, exact: false, ...args })),
    );
  });

  it("rejects invalid combinations before connecting despite the flat schema", async () => {
    const { bridge, client } = await start();
    const invalid = [
      {}, { tabId: 1 }, { tabId: 1, exact: false }, { tabId: 1, exact: true },
      { tabId: 1, query: "Save", exact: true },
      { tabId: 1, role: "button", exact: true },
      ...["", " \t\n", "x".repeat(101), 1, null].map((role) => ({
        tabId: 1, role,
      })),
      ...["", " \t\n", "x".repeat(201), 1, null].map((value) => ({
        tabId: 1, name: value,
      })),
      ...["", "x".repeat(201), 1, null].map((query) => ({ tabId: 1, query })),
      ...["true", 1, null].map((exact) => ({ tabId: 1, name: "Save", exact })),
      ...[0, -1, 1.5, "1"].map((tabId) => ({ tabId, query: "Save" })),
      { tabId: 1, name: "", exact: false, query: "Save" },
      { tabId: 1, name: "Save", extra: true },
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

  it.each([
    { args: { query: "none" }, content: 'No elements matched "none".' },
    { args: { role: "button", name: "none" },
      content: "No elements matched the semantic filters." },
    { args: { role: "textbox" },
      content: '[ref_7] textbox "Email" value="saved@example.com"' },
    { args: { query: "item" }, content: [
      ...Array.from({ length: 20 }, (_, i) => `[ref_${i + 1}] link "Item ${i}"`),
      "More than 20 matches; narrow the query.",
    ].join("\n") },
  ])("preserves plain result text: $content", async ({ args, content }) => {
    const payload = { content };
    const { client } = await start({ responses: [{ kind: "success", payload }] });
    const result = await client.callTool({ name, arguments: { tabId: 1, ...args } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
  });

  it("preserves a browser error without retrying or broadening the query", async () => {
    const error = { code: "TOOL_ERROR", message: "Accessibility query failed." };
    const { bridge, client } = await start({ responses: [{ kind: "error", error }] });
    const result = await client.callTool({
      name, arguments: { tabId: 1, role: "button", name: "Save", exact: true },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error });
    expect(bridge.receivedRequests).toHaveLength(1);
  });
});
