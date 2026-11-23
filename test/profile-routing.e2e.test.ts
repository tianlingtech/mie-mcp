import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProfileIdentity } from "@mie/tool-defs/profiles";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeBridge, type FakeBridgeOptions } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";
import { PACKAGE_VERSION } from "../src/package-info.js";

let root: string;
let registry: string;
const bridges: FakeBridge[] = [];
const harnesses: McpHarness[] = [];

beforeEach(async () => {
  root = await mkdtemp("/tmp/mie-mcp-profiles-");
  registry = join(root, "profiles");
  await mkdir(registry, { mode: 0o700 });
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
  await rm(root, { recursive: true, force: true });
});

async function start(environment: Record<string, string> = {}) {
  const harness = await startMcpClient(root, environment);
  harnesses.push(harness);
  return harness;
}

async function record(profile: ProfileIdentity, socketPath: string) {
  const file = join(registry, `${profile.id}.json`);
  await writeFile(file, JSON.stringify({
    version: 1, profile, socketPath,
    cdpEndpointPath: join(root, "unread-cdp.json"), pid: process.pid,
  }), { mode: 0o600 });
  return file;
}

async function profileBridge(name: string, options: FakeBridgeOptions = {}) {
  const profile = { id: randomUUID(), name, instanceId: randomUUID() };
  const bridge = await FakeBridge.start({
    ...options, hello: { profile, ...options.hello },
  });
  bridges.push(bridge);
  const file = await record(profile, bridge.socketPath);
  return { bridge, profile, file };
}

function call(harness: McpHarness, profile?: string) {
  return harness.client.callTool({
    name: "computer", arguments: {
      tabId: 1, action: "click", backendNodeId: 7,
      ...(profile === undefined ? {} : { profile }),
    },
  });
}

describe("profile routing over MCP stdio", () => {
  it("reports the running server version without any bridge", async () => {
    const harness = await start();
    expect(PACKAGE_VERSION).toBe("0.15.0");
    expect(harness.client.getServerVersion()).toEqual({
      name: "mie-mcp", version: PACKAGE_VERSION,
    });
    const result = await harness.client.callTool({ name: "profiles_list" });
    const expected = { serverVersion: PACKAGE_VERSION, profiles: [] };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expected) },
    ]);
  });

  it("isolates concurrent equal tab/ref requests and keeps omission on default", async () => {
    const first = await profileBridge("default");
    const second = await profileBridge("profile1");
    const harness = await start();
    const results = await Promise.all([call(harness), call(harness, "profile1")]);
    expect(results.every((result) => !result.isError)).toBe(true);
    for (const { bridge, profile } of [first, second]) {
      expect(bridge.receivedRequests).toHaveLength(1);
      expect(bridge.receivedRequests[0]).toMatchObject({
        expectedProfile: profile, args: { tabId: 1, backendNodeId: 7 },
      });
    }
    expect(first.bridge.receivedRequests[0]?.args).not.toHaveProperty("profile");
    expect(second.bridge.receivedRequests[0]?.args).toHaveProperty("profile", "profile1");
    await call(harness, "profile1");
    expect(second.bridge.connectionCount).toBe(1);
  });

  it("lists online identities without sending tools or exposing CDP details", async () => {
    const first = await profileBridge("profile1");
    const second = await profileBridge("profile2");
    await record({ id: randomUUID(), name: "offline", instanceId: randomUUID() },
      join(root, "gone.sock"));
    const harness = await start();
    const result = await harness.client.callTool({ name: "profiles_list" });
    expect(result.structuredContent).toEqual({
      serverVersion: PACKAGE_VERSION, profiles: [
      { ...first.profile, status: "online" },
      { ...second.profile, status: "online" },
    ] });
    expect(first.bridge.receivedRequests).toHaveLength(0);
    expect(second.bridge.receivedRequests).toHaveLength(0);
  });

  it("distinguishes missing/offline and never falls back from default", async () => {
    const named = await profileBridge("profile1");
    const harness = await start();
    expect((await call(harness)).structuredContent).toMatchObject({
      error: { code: "BRIDGE_NOT_RUNNING" },
    });
    expect((await call(harness, "missing")).structuredContent).toMatchObject({
      error: { code: "PROFILE_NOT_FOUND" },
    });
    await record({ id: randomUUID(), name: "default", instanceId: randomUUID() },
      join(root, "gone.sock"));
    expect((await call(harness)).structuredContent).toMatchObject({
      error: { code: "PROFILE_OFFLINE" },
    });
    expect(named.bridge.receivedRequests).toHaveLength(0);
  });

  it("preserves validated profile notes from the live hello", async () => {
    const profile = { id: randomUUID(), name: "noted", instanceId: randomUUID(),
      note: "Local fixture profile." };
    const bridge = await FakeBridge.start({ hello: { profile } });
    bridges.push(bridge);
    await record(profile, bridge.socketPath);
    const harness = await start();
    const result = await harness.client.callTool({ name: "profiles_list" });
    expect(result.structuredContent).toEqual({
      serverVersion: PACKAGE_VERSION, profiles: [
      { ...profile, status: "online" },
    ] });
    expect(bridge.receivedRequests).toHaveLength(0);
  });

  it("routes diagnostic read and clear only to the selected profile", async () => {
    const first = await profileBridge("default");
    const second = await profileBridge("diagnostics");
    const harness = await start();
    for (const action of ["read", "clear"]) {
      const result = await harness.client.callTool({ name: "screenshot_diagnostics",
        arguments: { profile: "diagnostics", action } });
      expect(result.isError).not.toBe(true);
    }
    expect(first.bridge.receivedRequests).toHaveLength(0);
    expect(second.bridge.receivedRequests).toHaveLength(2);
    for (const request of second.bridge.receivedRequests) {
      expect(request.expectedProfile).toEqual(second.profile);
      expect(request.args).toHaveProperty("profile", "diagnostics");
      expect(request.tool).toBe("screenshot_diagnostics");
    }
  });

  it("isolates graphics diagnostics with default and explicit profiles", async () => {
    const first = await profileBridge("default");
    const second = await profileBridge("graphics");
    const harness = await start();
    const calls = [
      { tabId: 1 },
      { profile: "graphics", tabId: 1, frameId: "opaque-child", maxCanvases: 20 },
    ];
    for (const args of calls) {
      const result = await harness.client.callTool({
        name: "graphics_diagnostics", arguments: args,
      });
      expect(result.isError).not.toBe(true);
    }
    for (const [index, { bridge, profile }] of [first, second].entries()) {
      expect(bridge.receivedRequests).toHaveLength(1);
      expect(bridge.receivedRequests[0]).toMatchObject({
        tool: "graphics_diagnostics", expectedProfile: profile,
        args: { maxCanvases: 10, ...calls[index] },
      });
    }
    expect(first.bridge.receivedRequests[0]?.args).toEqual({
      tabId: 1, maxCanvases: 10,
    });
  });

  it("rejects live duplicate names but ignores an unreachable duplicate", async () => {
    const first = await profileBridge("profile1");
    const second = await profileBridge("profile1");
    const harness = await start();
    for (const result of [await call(harness, "profile1"),
      await harness.client.callTool({ name: "profiles_list" })]) {
      expect(result.structuredContent).toMatchObject({
        error: { code: "PROFILE_CONFLICT" },
      });
    }
    expect(first.bridge.receivedRequests).toHaveLength(0);
    expect(second.bridge.receivedRequests).toHaveLength(0);
    await second.bridge.stop();
    expect((await call(harness, "profile1")).isError).not.toBe(true);
  });

  it("rejects identity mismatch before any tool request", async () => {
    const fixture = await profileBridge("profile1");
    await record({ ...fixture.profile, instanceId: randomUUID() },
      fixture.bridge.socketPath);
    const harness = await start();
    expect((await call(harness, "profile1")).structuredContent).toMatchObject({
      error: { code: "PROFILE_IDENTITY_MISMATCH" },
    });
    expect(fixture.bridge.receivedRequests).toHaveLength(0);
  });

  it("overrides only default and rejects a named identity on its legacy path", async () => {
    const first = await profileBridge("default");
    const second = await profileBridge("profile1");
    await record(first.profile, join(root, "unused.sock"));
    const harness = await start({ MIE_BRIDGE_SOCKET: first.bridge.socketPath });
    expect((await call(harness)).isError).not.toBe(true);
    expect((await call(harness, "profile1")).isError).not.toBe(true);
    const other = await start({ MIE_BRIDGE_SOCKET: second.bridge.socketPath });
    await rm(first.file);
    expect((await call(other)).structuredContent).toMatchObject({
      error: { code: "PROFILE_IDENTITY_MISMATCH" },
    });
    expect(second.bridge.receivedRequests).toHaveLength(1);
  });

  it("keeps legacy default callable without inventing a listed UUID", async () => {
    const bridge = await FakeBridge.start();
    bridges.push(bridge);
    const harness = await start({ MIE_BRIDGE_SOCKET: bridge.socketPath });
    expect(harness.client.getServerVersion()?.version).toBe(PACKAGE_VERSION);
    expect((await call(harness, "default")).isError).not.toBe(true);
    expect((await harness.client.callTool({ name: "profiles_list" }))
      .structuredContent).toEqual({ serverVersion: PACKAGE_VERSION, profiles: [] });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]).not.toHaveProperty("expectedProfile");
    expect(bridge.receivedRequests[0]?.args).toEqual({
      tabId: 1, action: "click", backendNodeId: 7,
    });
  });

  it("lists a new default identity on the legacy path without a record", async () => {
    const fixture = await profileBridge("default");
    await rm(fixture.file);
    const harness = await start({ MIE_BRIDGE_SOCKET: fixture.bridge.socketPath });
    expect((await harness.client.callTool({ name: "profiles_list" }))
      .structuredContent).toEqual({ serverVersion: PACKAGE_VERSION, profiles: [{
        ...fixture.profile, status: "online",
      }] });
  });

  it("discovers a renamed/restarted identity without replaying old requests", async () => {
    const first = await profileBridge("profile1", {
      responses: [{ kind: "disconnect-after-write" }],
    });
    const other = await profileBridge("profile2");
    const harness = await start();
    expect((await call(harness, "profile1")).structuredContent).toMatchObject({
      error: { code: "SENT_LINK_LOST" },
    });
    expect((await call(harness, "profile2")).isError).not.toBe(true);
    await rm(first.file);
    const replacement = await profileBridge("renamed");
    expect((await call(harness, "profile1")).structuredContent).toMatchObject({
      error: { code: "PROFILE_NOT_FOUND" },
    });
    expect((await call(harness, "renamed")).isError).not.toBe(true);
    expect(first.bridge.receivedRequests).toHaveLength(1);
    expect(other.bridge.receivedRequests).toHaveLength(1);
    expect(replacement.bridge.receivedRequests).toHaveLength(1);
  });

  it("rejects malformed profile arguments without connecting", async () => {
    const fixture = await profileBridge("default");
    const harness = await start();
    for (const profile of ["", "Profile1", "../default", "a".repeat(49)]) {
      expect((await call(harness, profile)).structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(fixture.bridge.connectionCount).toBe(0);
  });

  it("routes password references without reading or disclosing file data", async () => {
    const fixture = await profileBridge("profile-no-login", {
      responses: [{ kind: "success", payload: { ok: true, backendNodeId: 7 } }],
    });
    const harness = await start();
    const args = {
      tabId: 1, backendNodeId: 7, filePath: join(root, "nonexistent.key"),
      expectedOrigin: "https://example.com", expectedPathname: "/settings",
      profile: "profile-no-login",
    };
    const result = await harness.client.callTool({
      name: "set_password_from_file", arguments: args,
    });
    expect(result.structuredContent).toEqual({ ok: true, backendNodeId: 7 });
    expect(fixture.bridge.receivedRequests).toEqual([
      expect.objectContaining({ expectedProfile: fixture.profile, args }),
    ]);
  });

  it("drains retired connections without aborting already sent requests", async () => {
    const first = await profileBridge("profile1", {
      responses: [{ kind: "success", payload: { completed: true }, delayMs: 400 }],
    });
    await profileBridge("profile2");
    const harness = await start();
    const pending = call(harness, "profile1");
    await expect.poll(() => first.bridge.receivedRequests.length).toBe(1);
    await rm(first.file);
    expect((await call(harness, "profile2")).isError).not.toBe(true);
    expect((await pending).structuredContent).toEqual({ completed: true });
    expect((await call(harness, "profile1")).structuredContent).toMatchObject({
      error: { code: "PROFILE_NOT_FOUND" },
    });
  });

  it("closes every cached profile connection on stdio shutdown", async () => {
    await profileBridge("default");
    await profileBridge("profile1");
    const harness = await start();
    await Promise.all([call(harness), call(harness, "profile1")]);
    const pid = harness.transport.pid;
    expect(pid).not.toBeNull();
    await harness.close();
    expect(() => process.kill(pid as number, 0)).toThrow();
  });

  it.each(["invalid-json", "permissions", "symlink", "fifo"])(
    "fails closed on invalid discovery: %s", async (kind) => {
      const fixture = await profileBridge("profile1");
      if (kind === "invalid-json") await writeFile(fixture.file, "not-json");
      if (kind === "permissions") await chmod(fixture.file, 0o666);
      if (kind === "symlink") {
        await rm(fixture.file);
        await symlink(join(root, "absent"), fixture.file);
      }
      if (kind === "fifo") {
        await rm(fixture.file);
        await promisify(execFile)("mkfifo", [fixture.file]);
      }
      const harness = await start();
      expect((await call(harness, "profile1")).structuredContent).toMatchObject({
        error: { code: "NOT_SENT" },
      });
      expect(fixture.bridge.connectionCount).toBe(0);
    },
  );
});
