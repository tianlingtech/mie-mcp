import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
  for (const bridge of bridges.splice(0)) {
    await bridge.stop();
  }
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function startBridge(
  options: Parameters<typeof FakeBridge.start>[0] = {},
): Promise<FakeBridge> {
  const bridge = await FakeBridge.start(options);
  bridges.push(bridge);
  return bridge;
}

describe("MCP stdio server", () => {
  it("lists and calls a P0 tool through a fake bridge", async () => {
    const bridge = await startBridge({
      responses: [{ kind: "success", payload: { echoed: "hello" } }],
    });
    const harness = await startMcpClient(bridge.tempDirectory);
    harnesses.push(harness);
    const { client } = harness;

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "tabs_context",
      "tabs_create",
      "tabs_close",
      "navigate",
      "computer",
      "read_page",
      "get_page_text",
      "find",
      "form_input",
      "read_console_messages",
      "read_network_requests",
      "read_network_request",
      "set_input_files",
      "observation_history",
      "set_password_from_file",
      "profiles_list",
      "javascript_exec",
      "hover",
      "set_viewport",
      "inspect_element",
      "wait_for",
      "request",
      "profiles_launch",
      "screenshot_diagnostics",
      "graphics_diagnostics",
      "cookies_list",
    ]);

    const result = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ echoed: "hello" });
    expect(bridge.receivedRequests).toEqual([
      expect.objectContaining({
        type: "tool_request",
        tool: "tabs_context",
        args: {},
        timeout_ms: 30_000,
      }),
    ]);
  });

  it("starts and lists tools without a running bridge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mie-mcp-e2e-missing-"));
    tempDirectories.push(directory);
    const harness = await startMcpClient(directory);
    harnesses.push(harness);
    const { client } = harness;

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(26);

    const result = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "BRIDGE_NOT_RUNNING",
        hint: "请打开 Chrome 并启用 mie 插件",
      },
    });
  });

  it("rejects an incompatible bridge protocol version", async () => {
    const bridge = await startBridge({ hello: { protocol_version: 2 } });
    const harness = await startMcpClient(bridge.tempDirectory);
    harnesses.push(harness);
    const { client } = harness;

    const result = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "NOT_SENT" },
    });
    expect(JSON.stringify(result.structuredContent)).toContain("2");
    expect(JSON.stringify(result.structuredContent)).toContain("1");
  });

  it(
    "returns TIMEOUT when the bridge remains silent",
    async () => {
      const bridge = await startBridge({
        responses: [{ kind: "silent" }],
      });
      const harness = await startMcpClient(bridge.tempDirectory);
      harnesses.push(harness);
      const { client } = harness;

      const result = await client.callTool({
        name: "tabs_context",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "TIMEOUT" },
      });
    },
    45_000,
  );

  it("distinguishes disconnects before and after socket write", async () => {
    const bridge = await startBridge({
      connections: ["disconnect-before-hello", "normal"],
      responses: [{ kind: "disconnect-after-write" }],
    });
    const harness = await startMcpClient(bridge.tempDirectory);
    harnesses.push(harness);
    const { client } = harness;

    const notSent = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(notSent.structuredContent).toMatchObject({
      error: {
        code: "NOT_SENT",
        hint: "未送达, 可安全重试",
      },
    });

    const linkLost = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(linkLost.structuredContent).toMatchObject({
      error: {
        code: "SENT_LINK_LOST",
        hint: "已发出但结果未知, 请先截图确认副作用",
      },
    });
  });

  it("reconnects successfully after a sent request loses its link", async () => {
    const bridge = await startBridge({
      responses: [
        { kind: "disconnect-after-write" },
        { kind: "success", payload: { recovered: true } },
      ],
    });
    const harness = await startMcpClient(bridge.tempDirectory);
    harnesses.push(harness);
    const { client } = harness;

    const failed = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(failed.structuredContent).toMatchObject({
      error: { code: "SENT_LINK_LOST" },
    });

    const recovered = await client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(recovered.structuredContent).toEqual({ recovered: true });
  });
});
