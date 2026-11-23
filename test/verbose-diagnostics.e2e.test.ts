import { afterEach, describe, expect, it } from "vitest";

import { FakeBridge } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

const ENV_NAME = "MIE_VERBOSE_DIAGNOSTICS";
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

describe("verbose diagnostics over MCP stdio", () => {
  it.each([undefined, "unrecognized", "true", "1"])(
    "keeps frame content hidden for value %j",
    async (value) => {
      const marker = `hidden-e2e-marker${"x".repeat(value === "1" ? 10_000 : 0)}`;
      const { harness } = await startDiagnosticHarness(value, marker);

      await waitForDiagnostic(harness);
      const stderr = harness.stderr.join("");
      expect(stderr).toMatch(/prefixHash: '[a-f0-9]{16}'/);
      expect(stderr).toMatch(/length: \d+/);
      expect(stderr).not.toMatch(/hidden-e2e-marker|frameContent|contentTruncated/);
    },
  );

});

async function startDiagnosticHarness(
  value: string | undefined,
  marker: string,
): Promise<{ bridge: FakeBridge; harness: McpHarness }> {
  const bridge = await FakeBridge.start({
    responses: [
      {
        kind: "malformed",
        createFrame: (request) => ({
          id: request.id,
          type: "tool_response",
          error: {},
          marker,
        }),
      },
    ],
  });
  const environment = value === undefined ? {} : { [ENV_NAME]: value };
  const harness = await startMcpClient(bridge.tempDirectory, environment);
  bridges.push(bridge);
  harnesses.push(harness);
  await harness.client.callTool({ name: "tabs_context", arguments: {} });
  return { bridge, harness };
}

async function waitForDiagnostic(harness: McpHarness): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      harness.stderr
        .join("")
        .includes("Discarded invalid bridge protocol frame.")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for bridge diagnostic output.");
}
