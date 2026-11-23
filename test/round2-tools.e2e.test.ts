import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";
import { JPEG_SCREENSHOT_PAYLOAD } from "./support/screenshot-fixture.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(bridge: FakeBridge): Promise<McpHarness> {
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return harness;
}

async function fixture() {
  const bridge = await FakeBridge.start();
  bridges.push(bridge);
  return { bridge, harness: await start(bridge) };
}

describe("second-round tools over MCP stdio", () => {
  it("isolates process IDs and uses one ID for create, list and close", async () => {
    const { bridge, harness } = await fixture();
    const second = await start(bridge);
    const ids = [];
    for (const client of [harness.client, second.client]) {
      for (const [name, args] of [
        ["tabs_create", { captureNetwork: true, captureConsole: true }],
        ["tabs_context", { mineOnly: true }],
        ["tabs_close", { mineOnly: true }],
      ] as const) {
        expect((await client.callTool({ name, arguments: args })).isError)
          .not.toBe(true);
      }
      const requests = bridge.receivedRequests.slice(-3);
      const id = (requests[0]?.args as { sessionId: string }).sessionId;
      expect(id).toMatch(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
      expect(requests.every(({ args }) =>
        (args as { sessionId: string }).sessionId === id)).toBe(true);
      ids.push(id);
    }
    expect(new Set(ids).size).toBe(2);
    expect(bridge.receivedRequests[0]?.args).toMatchObject({
      captureNetwork: true, captureConsole: true,
    });
  });

  it("hides internal IDs and rejects client-supplied IDs before forwarding", async () => {
    const { bridge, harness } = await fixture();
    const listed = await harness.client.listTools();
    for (const name of ["tabs_create", "tabs_context", "tabs_close"]) {
      expect(listed.tools.find((tool) => tool.name === name)
        ?.inputSchema.properties).not.toHaveProperty("sessionId");
      for (const sessionId of ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", null, 1]) {
        const result = await harness.client.callTool({
          name, arguments: { mineOnly: true, sessionId },
        });
        expect(result.structuredContent).toMatchObject({
          error: { code: "INVALID_ARGUMENT" },
        });
      }
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect(bridge.connectionCount).toBe(0);
  });

  it("attributes explicit-ID close and keeps context unfiltered", async () => {
    const { bridge, harness } = await fixture();
    expect((await harness.client.callTool({
      name: "tabs_context", arguments: {},
    })).isError).not.toBe(true);
    expect(bridge.receivedRequests.at(-1)?.args).toEqual({});
    expect((await harness.client.callTool({
      name: "tabs_close", arguments: { tabIds: [1] },
    })).isError).not.toBe(true);
    expect(bridge.receivedRequests.at(-1)?.args).toEqual({
      tabIds: [1], sessionId: expect.any(String),
    });
    const result = await harness.client.callTool({ name: "tabs_close" });
    expect(result.structuredContent).toMatchObject({
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(bridge.receivedRequests).toHaveLength(2);
  });

  it("forwards JPEG transforms and rejects invalid format/path before capture", async () => {
    const bridge = await FakeBridge.start({ responses: [
      { kind: "success", payload: JPEG_SCREENSHOT_PAYLOAD },
    ] });
    bridges.push(bridge);
    const harness = await start(bridge);
    const args = { tabId: 1, action: "screenshot", format: "jpeg", quality: 60,
      scale: 0.5, clip: { x: 10, y: 20, width: 100, height: 80 } };
    const result = await harness.client.callTool({ name: "computer", arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
    ]));
    expect(bridge.receivedRequests[0]?.args).toEqual(args);
    for (const invalid of [
      { ...args, savePath: "page.png" },
      { ...args, format: "png" }, { ...args, scale: 0.09 },
      { ...args, quality: 101 }, { ...args, clip: { ...args.clip, x: -1 } },
    ]) {
      expect((await harness.client.callTool({
        name: "computer", arguments: invalid,
      })).structuredContent).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(bridge.receivedRequests).toHaveLength(1);
  });

  it("enforces javascript opt-in and bounds, then forwards defaults once", async () => {
    const { bridge, harness } = await fixture();
    const args = { tabId: 1, expectedOrigin: "https://example.com", code: "return 1;" };
    for (const invalid of [
      args, { ...args, allowUnsafe: false },
      { ...args, allowUnsafe: true, expectedOrigin: "https://example.com/path" },
      { ...args, allowUnsafe: true, timeoutMs: 15_001 },
      { ...args, allowUnsafe: true, maxChars: 50_001 },
    ]) {
      expect((await harness.client.callTool({
        name: "javascript_exec", arguments: invalid,
      })).structuredContent).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(bridge.receivedRequests).toHaveLength(0);
    expect((await harness.client.callTool({
      name: "javascript_exec", arguments: { ...args, allowUnsafe: true },
    })).isError).not.toBe(true);
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.args).toEqual({
      ...args, allowUnsafe: true, timeoutMs: 5000, maxChars: 20_000,
    });
  });
});
