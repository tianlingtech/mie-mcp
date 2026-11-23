import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";
import { JPEG_SCREENSHOT_PAYLOAD } from "./support/screenshot-fixture.js";

const RECTANGLE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFN"
  + "AAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==";
const payload = { base64: RECTANGLE_PNG, mimeType: "image/png" };
const viewport = { x: 12.5, y: 21.25, width: 5, height: 4 };
let bridge: FakeBridge | undefined;
let harness: McpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  await bridge?.stop();
  harness = undefined;
  bridge = undefined;
});

describe("screenshot coordinate mapping over MCP stdio", () => {
  it.each([
    [payload, "png", 3, 2],
    [JPEG_SCREENSHOT_PAYLOAD, "jpeg", 1, 1],
  ] as const)("maps image format %#", async (image, format, w, h) => {
    bridge = await FakeBridge.start({ responses: [{ kind: "success", payload: {
      ...image, width: 999, height: 999, screenshotViewport: viewport,
      obscured: false, coordinateMapping: { space: "untrusted" },
    } }] });
    harness = await startMcpClient(bridge.tempDirectory);
    const args = { tabId: 1, action: "screenshot", format, scale: 0.6,
      clip: viewport };
    const result = await harness.client.callTool({
      name: "computer", arguments: args,
    });
    const expected = { mimeType: image.mimeType, width: w, height: h,
      obscured: false, screenshotViewport: viewport,
      coordinateMapping: { space: "viewport-css",
        origin: { x: viewport.x, y: viewport.y },
        cssPixelsPerImagePixel: { x: 5 / w, y: 4 / h } } };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([
      { type: "image", data: image.base64, mimeType: image.mimeType },
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    expect(bridge.receivedRequests[0]?.args).toEqual(args);
  });

  it("does not infer a missing mapping from request scale or clip", async () => {
    bridge = await FakeBridge.start({
      responses: [{ kind: "success", payload }],
    });
    harness = await startMcpClient(bridge.tempDirectory);
    const result = await harness.client.callTool({ name: "computer",
      arguments: { tabId: 1, action: "screenshot", scale: 0.6, clip: viewport },
    });
    expect(result.structuredContent).toEqual({
      mimeType: "image/png", width: 3, height: 2,
    });
  });

  it.each([
    null, {}, { ...viewport, x: -1 }, { ...viewport, y: -1 },
    { ...viewport, width: 0 }, { ...viewport, height: 0 },
    { ...viewport, x: 1000001 }, { ...viewport, y: 1000001 },
    { ...viewport, width: 1000001 }, { ...viewport, height: 1000001 },
    { ...viewport, x: "1" }, { ...viewport, width: null },
  ])("rejects invalid viewport metadata %#", async (screenshotViewport) => {
    bridge = await FakeBridge.start({ responses: [{ kind: "success",
      payload: { ...payload, screenshotViewport } }] });
    harness = await startMcpClient(bridge.tempDirectory);
    const result = await harness.client.callTool({ name: "computer",
      arguments: { tabId: 1, action: "screenshot" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: {
      code: "TOOL_ERROR", message: "Invalid screenshot response.",
    } });
    expect(result.content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image" }),
    ]));
  });
});
