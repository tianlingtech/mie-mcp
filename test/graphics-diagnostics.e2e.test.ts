import { afterEach, describe, expect, it } from "vitest";
import { GraphicsDiagnosticsResultSchema } from "@mie/tool-defs/schemas";

import { EXPECTED_TOOL_DEFS_VERSION } from "../src/tool-defs.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const name = "graphics_diagnostics";

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

describe("graphics diagnostics over MCP stdio", () => {
  it("injects the canvas limit without inventing frame or profile IDs", async () => {
    const { bridge, client } = await start();
    const result = await client.callTool({ name, arguments: { tabId: 1 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ tabId: 1, maxCanvases: 10 });
    expect(bridge.receivedRequests).toEqual([{
      id: expect.any(String), type: "tool_request", tool: name,
      args: { tabId: 1, maxCanvases: 10 }, timeout_ms: 30_000,
    }]);
  });

  it("preserves explicit frame IDs and canvas limit boundaries", async () => {
    const { bridge, client } = await start();
    const calls = [
      { tabId: 1, frameId: "F", maxCanvases: 1 },
      { tabId: 2, frameId: "Frame.Mixed 空", maxCanvases: 20 },
      { tabId: 3, frameId: "f".repeat(256), maxCanvases: 10 },
    ];
    for (const args of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid arguments before opening a bridge connection", async () => {
    const { bridge, client } = await start();
    const invalid = [
      {},
      ...[0, -1, 1.5, "1", null].map((tabId) => ({ tabId })),
      ...["", "f".repeat(257), 1, null].map((frameId) => ({ tabId: 1, frameId })),
      ...[0, 21, 1.5, "10", null].map((maxCanvases) => ({
        tabId: 1, maxCanvases,
      })),
      ...["", "has space", "p".repeat(49), 1, null].map((profile) => ({
        tabId: 1, profile,
      })),
      ...[{ code: "return 1;" }, { selector: "canvas" }, { allowUnsafe: true },
        { backendNodeId: 7 }, { sessionId: "forged" }]
        .map((args) => ({ tabId: 1, ...args })),
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

  it("preserves the extension's validated content envelope", async () => {
    const inner = GraphicsDiagnosticsResultSchema.parse({
      frameId: "opaque-child", visibilityScope: "frame_local_css_and_viewport",
      viewport: { width: 800, height: 600, devicePixelRatio: 2 },
      canvases: [{
        index: 0, buffer: { width: 1600, height: 1200 },
        rect: { x: -10, y: 20, width: 800, height: 600 },
        cssVisible: true, intersectsViewport: true,
        webgl: { contextLost: "unknown",
          reason: "existing_context_reference_unavailable" },
      }],
      scannedElements: 2000, truncated: true,
    });
    const payload = { content: JSON.stringify(inner) };
    const { bridge, client } = await start({
      responses: [{ kind: "success", payload }],
    });
    const result = await client.callTool({ name,
      arguments: { tabId: 1, frameId: "opaque-child" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(bridge.receivedRequests).toHaveLength(1);
  });

  it.each(["TOOL_ERROR", "TIMEOUT"])(
    "preserves %s without retrying against another frame", async (code) => {
      const error = { code, message: "Selected frame diagnostics failed." };
      const { bridge, client } = await start({
        responses: [{ kind: "error", error }],
      });
      const result = await client.callTool({ name,
        arguments: { tabId: 1, frameId: "stale-child" } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error });
      expect(bridge.receivedRequests).toHaveLength(1);
      expect(bridge.receivedRequests[0]?.args).toEqual({
        tabId: 1, frameId: "stale-child", maxCanvases: 10,
      });
    },
  );
});
