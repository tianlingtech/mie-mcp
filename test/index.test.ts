import { describe, expect, it } from "vitest";

import {
  BRIDGE_SOCKET_ENV,
  parseBridgeSocketPath,
  parseVerboseDiagnostics,
  VERBOSE_DIAGNOSTICS_ENV,
} from "../src/index.js";
import { PACKAGE_VERSION } from "../src/package-info.js";

describe("server entry module", () => {
  it("reads its version from package.json", async () => {
    const packageJson = (await import("../package.json", {
      with: { type: "json" },
    })) as { default: { version: string } };

    expect(PACKAGE_VERSION).toBe(packageJson.default.version);
    expect(packageJson.default).toMatchObject({
      dependencies: {
        "@mie/tool-defs": "file:../mie/packages/tool-defs",
        zod: "4.5.4",
      },
    });
  });

  it("does not start the server when imported", async () => {
    const dataListeners = process.stdin.listenerCount("data");
    const signalListeners = process.listenerCount("SIGTERM");

    const entry = await import("../src/index.js");

    expect(entry.isDirectExecution(import.meta.url, undefined)).toBe(false);
    expect(process.stdin.listenerCount("data")).toBe(dataListeners);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners);
  });

  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["yes", false],
    ["unrecognized", false],
    ["1", true],
    ["true", true],
    [" TRUE ", true],
  ] as const)("parses verbose diagnostics value %j", (value, expected) => {
    expect(parseVerboseDiagnostics(value)).toBe(expected);
  });

  it("uses the documented verbose diagnostics environment variable", () => {
    expect(VERBOSE_DIAGNOSTICS_ENV).toBe("MIE_VERBOSE_DIAGNOSTICS");
  });

  it.each([
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
    ["/tmp/mie-e2e/bridge.sock", "/tmp/mie-e2e/bridge.sock"],
    [" /tmp/mie-e2e/bridge.sock ", "/tmp/mie-e2e/bridge.sock"],
  ] as const)("parses bridge socket path value %j", (value, expected) => {
    expect(parseBridgeSocketPath(value)).toBe(expected);
  });

  it("uses the documented bridge socket environment variable", () => {
    expect(BRIDGE_SOCKET_ENV).toBe("MIE_BRIDGE_SOCKET");
  });
});
