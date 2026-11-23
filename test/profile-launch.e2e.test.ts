import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile }
  from "node:fs/promises";
import { join } from "node:path";
import type { ProfileIdentity } from "@mie/tool-defs/profiles";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeBridge, type FakeBridgeOptions } from "./support/fake-bridge.js";
import { McpHarness, startMcpClient } from "./support/mcp-harness.js";

let root: string;
let profile: ProfileIdentity;
const bridges: FakeBridge[] = [];
const clients: McpHarness[] = [];

beforeEach(async () => {
  root = await mkdtemp("/tmp/mie-mcp-launch-");
  await mkdir(join(root, "profiles"), { mode: 0o700 });
  profile = { id: randomUUID(), name: "fixture", instanceId: randomUUID() };
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
  await rm(root, { recursive: true, force: true });
});

async function start(configPath?: string) {
  const client = await startMcpClient(root, configPath === undefined ? {}
    : { MIE_PROFILE_LAUNCH_CONFIG: configPath });
  clients.push(client);
  return client;
}

async function publish(
  identity = profile, options: FakeBridgeOptions = {},
) {
  const bridge = await FakeBridge.start({ ...options, hello: { profile: identity } });
  bridges.push(bridge);
  await writeFile(join(root, "profiles", `${identity.id}.json`), JSON.stringify({
    version: 1, profile: identity, socketPath: bridge.socketPath,
    cdpEndpointPath: join(root, "unused.json"), pid: process.pid,
  }), { mode: 0o600 });
  return bridge;
}

async function config(exitCode = 0, lingerMs = 0) {
  const executable = join(root, "chrome-fixture.cjs");
  const marker = join(root, "argv.json");
  await writeFile(executable, `#!${process.execPath}\n` +
    `require('node:fs').appendFileSync(${JSON.stringify(marker)}, ` +
    `JSON.stringify(process.argv.slice(2)) + '\\n');\n` +
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, "pid"))}, ` +
    `String(process.pid));\n` +
    `setTimeout(() => process.exit(${exitCode}), ${lingerMs});\n`, { mode: 0o700 });
  const userDataDir = join(root, "Chrome data $(literal)");
  const profileDirectory = "Profile 7";
  await mkdir(join(userDataDir, profileDirectory), { recursive: true, mode: 0o700 });
  const target = { profileId: profile.id, executable, userDataDir, profileDirectory };
  const path = join(root, "launch.json");
  await writeFile(path, JSON.stringify({ version: 1, profiles: { fixture: target } }),
    { mode: 0o600 });
  return { path, target, marker };
}

function launch(client: McpHarness, args: Record<string, unknown> = {}) {
  return client.client.callTool({ name: "profiles_launch",
    arguments: { profile: "fixture", timeoutMs: 2000, ...args } });
}

describe("profile launch over real MCP stdio with simulated Chrome", () => {
  it("returns online identity without a mapping or tool request", async () => {
    const bridge = await publish();
    const client = await start();
    expect((await launch(client)).structuredContent).toEqual({
      profile, status: "online", launched: false,
    });
    expect(bridge.receivedRequests).toHaveLength(0);
  });

  it("checks configured UUID even when the name is already online", async () => {
    const fixture = await config();
    const bridge = await publish({ ...profile, id: randomUUID() });
    const client = await start(fixture.path);
    expect((await launch(client)).structuredContent).toMatchObject({
      error: { code: "PROFILE_IDENTITY_MISMATCH" },
    });
    expect(bridge.receivedRequests).toHaveLength(0);
    await expect(readFile(fixture.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits after exit zero and verifies identity with fixed literal argv", async () => {
    const fixture = await config();
    const client = await start(fixture.path);
    const pending = launch(client);
    await expect.poll(async () => readFile(fixture.marker, "utf8")).toBeTruthy();
    const fresh = { ...profile, instanceId: randomUUID() };
    const bridge = await publish(fresh);
    expect((await pending).structuredContent).toEqual({
      profile: fresh, status: "online", launched: true,
    });
    const argv = (await readFile(fixture.marker, "utf8")).trim().split("\n");
    expect(argv.map((line) => JSON.parse(line))).toEqual([[
      `--user-data-dir=${fixture.target.userDataDir}`,
      "--profile-directory=Profile 7", "--no-startup-window",
    ]]);
    expect(bridge.receivedRequests).toHaveLength(0);
  });

  it("coalesces concurrent starts while retaining each caller's timeout", async () => {
    const fixture = await config();
    const client = await start(fixture.path);
    const first = launch(client);
    await expect.poll(async () => readFile(fixture.marker, "utf8")).toBeTruthy();
    const short = await launch(client, { timeoutMs: 30 });
    expect(short.structuredContent).toMatchObject({
      error: { code: "PROFILE_LAUNCH_TIMEOUT" },
    });
    const second = launch(client);
    await publish();
    for (const result of await Promise.all([first, second])) {
      expect(result.structuredContent).toEqual({ profile, status: "online",
        launched: true });
    }
    const starts = (await readFile(fixture.marker, "utf8")).trim().split("\n");
    expect(starts).toHaveLength(1);
  });

  it("fails without an explicit mapping and does not guess a Chrome directory", async () => {
    const client = await start();
    expect((await launch(client)).structuredContent).toMatchObject({
      error: { code: "PROFILE_LAUNCH_NOT_CONFIGURED" },
    });
  });

  it.each(["json", "permissions", "symlink", "argv", "traversal", "missing-dir"])(
    "rejects unsafe configuration before launch: %s", async (kind) => {
      const fixture = await config();
      if (kind === "json") await writeFile(fixture.path, "not-json");
      if (kind === "permissions") await chmod(fixture.path, 0o644);
      if (kind === "symlink") {
        const link = join(root, "launch-link.json");
        await symlink(fixture.path, link);
        fixture.path = link;
      }
      if (kind === "argv" || kind === "traversal") {
        await writeFile(fixture.path, JSON.stringify({ version: 1, profiles: {
          fixture: { ...fixture.target, ...(kind === "argv"
            ? { args: ["--remote-debugging-port=9222"] }
            : { profileDirectory: "../outside" }) },
        } }));
      }
      if (kind === "missing-dir") {
        await rm(join(fixture.target.userDataDir, fixture.target.profileDirectory),
          { recursive: true });
      }
      const client = await start(fixture.path);
      expect((await launch(client)).structuredContent).toMatchObject({
        error: { code: "PROFILE_LAUNCH_CONFIG_INVALID" },
      });
      await expect(readFile(fixture.marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(["nonzero", "enoent"])("reports launch failure: %s", async (kind) => {
    const fixture = await config(7);
    if (kind === "enoent") {
      await writeFile(fixture.target.executable, "#!/nonexistent/mie-interpreter\n");
    }
    const client = await start(fixture.path);
    expect((await launch(client)).structuredContent).toMatchObject({
      error: { code: "PROFILE_LAUNCH_FAILED" },
    });
  });

  it("times out without terminating the started process or replaying", async () => {
    const fixture = await config(0, 3500);
    const client = await start(fixture.path);
    const result = await launch(client, { timeoutMs: 2000 });
    expect(result.structuredContent).toMatchObject({ error: {
      code: "PROFILE_LAUNCH_TIMEOUT", hint: expect.stringContaining("未被终止"),
    } });
    const pid = Number(await readFile(join(root, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }, { timeout: 5000 }).toBe(false);
    const starts = (await readFile(fixture.marker, "utf8")).trim().split("\n");
    expect(starts).toHaveLength(1);
  });

  it("reports nonzero exit immediately even while the new hello is stalled", async () => {
    const fixture = await config(7, 350);
    const client = await start(fixture.path);
    const started = performance.now();
    const pending = launch(client);
    await expect.poll(async () => readFile(fixture.marker, "utf8")).toBeTruthy();
    await publish(profile, { connections: ["no-hello"] });
    expect((await pending).structuredContent).toMatchObject({
      error: { code: "PROFILE_LAUNCH_FAILED" },
    });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("bounds a nonresponsive hello without spawning or retaining its connection", async () => {
    const fixture = await config();
    const bridge = await publish(profile, { connections: ["no-hello"] });
    const client = await start(fixture.path);
    const started = performance.now();
    expect((await launch(client, { timeoutMs: 80 })).structuredContent)
      .toMatchObject({ error: { code: "PROFILE_LAUNCH_TIMEOUT" } });
    expect(performance.now() - started).toBeLessThan(1000);
    expect((await launch(client)).structuredContent).toMatchObject({ launched: false });
    expect(bridge.connectionCount).toBe(2);
    await expect(readFile(fixture.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate live names without another start", async () => {
    await publish();
    await publish({ ...profile, id: randomUUID() });
    expect((await launch(await start())).structuredContent).toMatchObject({
      error: { code: "PROFILE_CONFLICT" },
    });
  });

  it("rejects malformed tool inputs before connecting or starting", async () => {
    const bridge = await publish();
    const client = await start();
    for (const args of [{}, { profile: "../bad" },
      { profile: "fixture", command: "x" },
      ...[0, 60_001, 1.5, "100"].map((timeoutMs) => ({ profile: "fixture", timeoutMs }))]) {
      const result = await client.client.callTool({ name: "profiles_launch",
        arguments: args });
      expect(result.structuredContent).toMatchObject({
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(bridge.connectionCount).toBe(0);
  });

  it("preserves unknown close outcome without retry", async () => {
    const bridge = await publish(profile, {
      responses: [{ kind: "disconnect-after-write" }],
    });
    const client = await start();
    const result = await client.client.callTool({ name: "tabs_close",
      arguments: { profile: "fixture", tabIds: [12] } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: {
      code: "SENT_LINK_LOST", hint: expect.stringContaining("profiles_launch"),
    } });
    expect(JSON.stringify(result.structuredContent)).toContain("不要自动重试关闭");
    expect((await launch(client)).structuredContent).toMatchObject({ launched: false });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(bridge.receivedRequests[0]?.tool).toBe("tabs_close");
  });
});
