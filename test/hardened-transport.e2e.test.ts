import { afterEach, describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "../src/package-info.js";
import { FakeBridge, type FakeResponsePlan } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const harnesses: McpHarness[] = [];
const bridges: FakeBridge[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
  for (const bridge of bridges.splice(0)) {
    await bridge.stop();
  }
});

async function track(
  bridge: FakeBridge,
): Promise<{ bridge: FakeBridge; harness: McpHarness }> {
  const harness = await startMcpClient(bridge.tempDirectory);
  bridges.push(bridge);
  harnesses.push(harness);
  return { bridge, harness };
}

function malformedResponses(): FakeResponsePlan[] {
  const errorValues: unknown[] = [{}, "boom", null, { code: 123 }, { code: "" }];
  const plans = errorValues.map<FakeResponsePlan>((error) => ({
    kind: "malformed",
    createFrame: (request) => ({
      id: request.id,
      type: "tool_response",
      error,
    }),
  }));
  plans.push(
    {
      kind: "malformed",
      createFrame: (request) => ({
        id: request.id,
        type: "tool_response",
        payload: {},
        error: { code: "TOOL_ERROR" },
      }),
    },
    {
      kind: "malformed",
      createFrame: (request) => ({
        id: request.id,
        type: "tool_response",
      }),
    },
  );
  return plans;
}

describe("hardened bridge transport over MCP stdio", () => {
  it(
    "recovers after a bridge accepts a connection without hello",
    async () => {
      const { bridge, harness } = await track(
        await FakeBridge.start({
          connections: ["no-hello", "normal"],
          responses: [{ kind: "success", payload: { recovered: true } }],
        }),
      );

      const failed = await harness.client.callTool({
        name: "tabs_context",
        arguments: {},
      });
      expect(failed.structuredContent).toMatchObject({
        error: { code: "NOT_SENT" },
      });

      const recovered = await harness.client.callTool({
        name: "tabs_context",
        arguments: {},
      });
      expect(recovered.structuredContent).toEqual({ recovered: true });
      expect(bridge.connectionCount).toBe(2);
    },
    20_000,
  );

  it("settles all seven malformed response shapes without fallback delay", async () => {
    const { harness } = await track(
      await FakeBridge.start({ responses: malformedResponses() }),
    );
    const startedAt = Date.now();

    for (let index = 0; index < 7; index += 1) {
      const result = await harness.client.callTool({
        name: "tabs_context",
        arguments: {},
      });
      expect(result.structuredContent).toMatchObject({
        error: { code: "TOOL_ERROR" },
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("protocol_version");
      expect(serialized).not.toContain("bridge_version");
      expect(serialized).toMatch(/payload|error|code/);
      const issues = (
        result.structuredContent as {
          error: { data: { issues: unknown[] } };
        }
      ).error.data.issues;
      expect(issues.length).toBeLessThanOrEqual(32);
    }

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("accepts unknown fields on hello, success, error, and error data", async () => {
    const { harness } = await track(
      await FakeBridge.start({
        hello: { capabilities: ["events"] },
        responses: [
          {
            kind: "success",
            payload: { ok: true },
            responseExtras: { duration_ms: 5 },
          },
          {
            kind: "error",
            error: {
              code: "TIMEOUT",
              data: { future_detail: true },
              extra_error_field: true,
            },
            responseExtras: { retriable: true },
          },
        ],
      }),
    );

    const success = await harness.client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(success.structuredContent).toEqual({ ok: true });

    const error = await harness.client.callTool({
      name: "tabs_context",
      arguments: {},
    });
    expect(error.structuredContent).toMatchObject({
      error: { code: "TIMEOUT" },
    });
  });

  it("exits naturally after stdin EOF with an active bridge socket", async () => {
    const { harness } = await track(await FakeBridge.start());
    await harness.client.callTool({ name: "tabs_context", arguments: {} });
    const pid = harness.transport.pid;
    expect(pid).not.toBeNull();

    const startedAt = Date.now();
    await harness.close();

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(isProcessRunning(pid as number)).toBe(false);
  });

  it("closes the server process on SIGTERM", async () => {
    const { harness } = await track(await FakeBridge.start());
    await harness.client.callTool({ name: "tabs_context", arguments: {} });
    const pid = harness.transport.pid;
    expect(pid).not.toBeNull();

    const startedAt = Date.now();
    process.kill(pid as number, "SIGTERM");
    await harness.close();

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(isProcessRunning(pid as number)).toBe(false);
  });

  it("declares the package version to the MCP client", async () => {
    const { harness } = await track(await FakeBridge.start());

    expect(harness.client.getServerVersion()).toMatchObject({
      name: "mie-mcp",
      version: PACKAGE_VERSION,
    });
  });
});

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
