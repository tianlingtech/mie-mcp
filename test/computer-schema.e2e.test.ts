import { afterEach, describe, expect, it } from "vitest";

import { PNG_BASE64, SCREENSHOT_PAYLOAD }
  from "./support/screenshot-fixture.js";
import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

let bridge: FakeBridge | undefined;
let harness: McpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  await bridge?.stop();
  harness = undefined;
  bridge = undefined;
});

describe("computer schema over MCP stdio", () => {
  it("exposes compatible coordinates and forwards clicks to computer", async () => {
    bridge = await FakeBridge.start();
    harness = await startMcpClient(bridge.tempDirectory);
    const { tools } = await harness.client.listTools();
    const computer = tools.find((tool) => tool.name === "computer");
    expect(computer).toBeDefined();
    expect(tools.some((tool) => tool.name === "browser_interact")).toBe(false);
    expect(computer?.inputSchema.properties?.["coordinate"]).toEqual({
      type: "array", items: { type: "number", minimum: 0 },
      minItems: 2, maxItems: 2,
    });

    const args = { tabId: 1, action: "click", coordinate: [10, 20] };
    const result = await harness.client.callTool({
      name: "computer", arguments: args,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(args);
    expect(bridge.receivedRequests.map(({ tool }) => tool)).toEqual([
      "computer",
    ]);
  });

  it("rejects conflicting click targets before connecting to the bridge", async () => {
    bridge = await FakeBridge.start();
    harness = await startMcpClient(bridge.tempDirectory);
    const result = await harness.client.callTool({
      name: "computer",
      arguments: {
        tabId: 1, action: "click", backendNodeId: 7, coordinate: [10, 20],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(bridge.connectionCount).toBe(0);
  });

  it("advertises optional key holdMs and forwards valid values", async () => {
    bridge = await FakeBridge.start({
      hello: { protocol_version: 1, tool_defs_version: "0.31.0" },
    });
    harness = await startMcpClient(bridge.tempDirectory);
    const { tools } = await harness.client.listTools();
    const computer = tools.find(({ name }) => name === "computer");
    expect(computer?.inputSchema.properties?.["holdMs"]).toEqual({
      type: "integer", minimum: 0, maximum: 1_000,
    });
    expect(computer?.inputSchema.required).not.toContain("holdMs");

    const key = { tabId: 1, action: "key", key: "Enter" };
    const calls = [key, { ...key, holdMs: 0 }, { ...key, holdMs: 120 },
      { ...key, holdMs: 1_000 }];
    for (const args of calls) {
      const result = await harness.client.callTool({
        name: "computer", arguments: args,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(args);
    }
    expect(bridge.receivedRequests.map(({ args }) => args)).toEqual(calls);
  });

  it("rejects invalid holdMs before connecting to the bridge", async () => {
    bridge = await FakeBridge.start();
    harness = await startMcpClient(bridge.tempDirectory);
    const key = { tabId: 1, action: "key", key: "Enter" };
    const calls = [-1, 1_001, 120.5, "120"].map((holdMs) => ({
      ...key, holdMs,
    }));
    for (const args of [...calls, {
      tabId: 1, action: "wait", milliseconds: 10, holdMs: 120,
    }]) {
      const result = await harness.client.callTool({
        name: "computer", arguments: args,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
  });

  it("preserves screenshot payloads and bridge errors", async () => {
    const payload = SCREENSHOT_PAYLOAD;
    bridge = await FakeBridge.start({
      responses: [
        { kind: "success", payload },
        { kind: "error", error: { code: "TAB_GONE", message: "Tab gone." } },
      ],
    });
    harness = await startMcpClient(bridge.tempDirectory);
    const input = {
      name: "computer",
      arguments: { tabId: 1, action: "screenshot" },
    };
    const result = await harness.client.callTool(input);
    const metadata = { mimeType: "image/png",
      width: 1, height: 1 };
    expect(result.structuredContent).toEqual(metadata);
    expect(result.content).toEqual([
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      { type: "text", text: JSON.stringify(metadata) },
    ]);
    const failure = await harness.client.callTool(input);
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toMatchObject({
      error: { code: "TAB_GONE", message: "Tab gone." },
    });
    expect(bridge.receivedRequests.every(({ tool }) => tool === "computer"))
      .toBe(true);
  });

  it("keeps coordinate validation strict", async () => {
    bridge = await FakeBridge.start();
    harness = await startMcpClient(bridge.tempDirectory);
    for (const coordinate of [[1], [1, 2, 3], [-1, 2], ["1", 2]]) {
      const result = await harness.client.callTool({
        name: "computer", arguments: { tabId: 1, action: "click", coordinate },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
  });
});
