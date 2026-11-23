import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const name = "set_password_from_file";
const args = {
  tabId: 1,
  backendNodeId: 7,
  filePath: "/tmp/mie-test-dummy-password.key",
  expectedOrigin: "https://example.com",
  expectedPathname: "/settings",
};
const canary = "dummy-password-never-return";
const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
});

async function start(options: Parameters<typeof FakeBridge.start>[0] = {}) {
  const bridge = await FakeBridge.start(options);
  bridges.push(bridge);
  const harness = await startMcpClient(bridge.tempDirectory);
  harnesses.push(harness);
  return { bridge, harness, client: harness.client };
}

describe("password file input over MCP stdio", () => {
  it("exposes five required fields and optional profile routing", async () => {
    const { client } = await start();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === name);
    expect(tool).toBeDefined();
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort())
      .toEqual([...Object.keys(args), "profile"].sort());
    expect(tool?.inputSchema.required?.toSorted())
      .toEqual(Object.keys(args).sort());
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  });

  it("forwards the file reference without reading it or adding secret data",
    async () => {
      const payload = { ok: true, backendNodeId: args.backendNodeId };
      const { bridge, client, harness } = await start({
        responses: [{ kind: "success", payload }],
      });
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(payload);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(payload) },
      ]);
      expect(bridge.receivedRequests).toEqual([
        expect.objectContaining({ tool: name, args }),
      ]);
      expect(harness.stderr.join("")).not.toContain(canary);
    });

  it("rejects internal fields and invalid targets before connecting", async () => {
    const { bridge, client, harness } = await start();
    const invalid = [
      { ...args, value: canary },
      { ...args, text: canary },
      { ...args, secret: canary },
      { ...args, frameId: "child-frame" },
      { ...args, tabId: 0 },
      { ...args, backendNodeId: 0 },
      { ...args, filePath: "relative.key" },
      { ...args, filePath: "/tmp/dummy\0.key" },
      { ...args, expectedOrigin: "https://example.com/settings" },
      { ...args, expectedOrigin: "https://user@example.com" },
      { ...args, expectedOrigin: "https://example.com?query=1" },
      { ...args, expectedPathname: "settings" },
    ];
    for (const input of invalid) {
      const result = await client.callTool({ name, arguments: input });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
      expect(JSON.stringify(result)).not.toContain(canary);
    }
    expect(bridge.connectionCount).toBe(0);
    expect(harness.stderr.join("")).not.toContain(canary);
  });

  it.each([
    "INVALID_SECRET_SOURCE", "SECRET_TARGET_MISMATCH", "SECRET_INPUT_FAILED",
    "NOT_SENT", "SENT_LINK_LOST", "TIMEOUT",
  ])("preserves %s without retrying the setting request", async (code) => {
    const { bridge, client } = await start({ responses: [{
      kind: "error", error: { code, message: "Password input failed." },
    }] });
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code, message: "Password input failed." },
    });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
