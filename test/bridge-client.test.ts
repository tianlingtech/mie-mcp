import { mkdtemp, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BridgeError } from "../src/bridge-error.js";
import {
  BridgeClient,
  type BridgeDiagnostic,
} from "../src/bridge-client.js";
import { resolveBridgeSocketPath } from "../src/socket-path.js";
import { FakeBridge } from "./support/fake-bridge.js";

const bridges: FakeBridge[] = [];
const clients: BridgeClient[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
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

function createClient(
  socketPath: string,
  options: {
    fallbackGraceMs?: number;
    handshakeTimeoutMs?: number;
    maxBufferBytes?: number;
    verboseDiagnostics?: boolean;
    expectedToolDefsVersion?: string;
    onDiagnostic?: (diagnostic: BridgeDiagnostic) => void;
    createSocket?: () => Socket;
  } = {},
): BridgeClient {
  const client = new BridgeClient({
    socketPath,
    requestPrefix: "test-client",
    onDiagnostic: options.onDiagnostic ?? (() => {}),
    ...(options.fallbackGraceMs === undefined
      ? {}
      : { fallbackGraceMs: options.fallbackGraceMs }),
    ...(options.handshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ...(options.maxBufferBytes === undefined
      ? {}
      : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.verboseDiagnostics === undefined
      ? {}
      : { verboseDiagnostics: options.verboseDiagnostics }),
    ...(options.expectedToolDefsVersion === undefined
      ? {}
      : { expectedToolDefsVersion: options.expectedToolDefsVersion }),
    ...(options.createSocket === undefined
      ? {}
      : { createSocket: options.createSocket }),
  });
  clients.push(client);
  return client;
}

async function waitForRequests(bridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (bridge.receivedRequests.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Fake bridge did not receive ${count} request(s).`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function expectBridgeError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(BridgeError);
  expect((error as BridgeError).code).toBe(code);
}

async function collectInvalidFrameDiagnostics(
  verboseDiagnostics?: boolean,
  marker = "stable-diagnostic-marker",
): Promise<BridgeDiagnostic[]> {
  const bridge = await startBridge({
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
  const diagnostics: BridgeDiagnostic[] = [];
  const client = createClient(bridge.socketPath, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    ...(verboseDiagnostics === undefined ? {} : { verboseDiagnostics }),
  });

  await expect(
    client.request({ tool: "tabs_context", args: {}, timeoutMs: 100 }),
  ).rejects.toMatchObject({ code: "TOOL_ERROR" });
  return diagnostics;
}

describe("BridgeClient", () => {
  it("probes hello without sending tools and reuses the connection", async () => {
    const bridge = await startBridge();
    const client = createClient(bridge.socketPath);
    const [first, second] = await Promise.all([client.connect(), client.connect()]);
    expect(first).toEqual(second);
    expect(first.toolDefsVersion).toBe("0.1.0");
    expect(bridge.connectionCount).toBe(1);
    expect(bridge.receivedRequests).toHaveLength(0);
    await client.request({ tool: "tabs_context", args: {}, timeoutMs: 100 });
    expect(bridge.connectionCount).toBe(1);
    client.close();
    await expect(client.connect()).rejects.toMatchObject({ code: "NOT_SENT" });
  });

  it("connects lazily, waits for hello, and records handshake versions", async () => {
    const bridge = await startBridge({ helloDelayMs: 20 });
    const diagnostics: BridgeDiagnostic[] = [];
    const client = createClient(bridge.socketPath, {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(client.getHandshakeInfo()).toBeUndefined();
    expect(bridge.receivedRequests).toHaveLength(0);

    await expect(
      client.request({ tool: "stub.echo", args: { ok: true }, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
    expect(client.getHandshakeInfo()).toEqual({
      bridgeVersion: "fake-bridge-1.0.0",
      toolDefsVersion: "0.1.0",
    });
    expect(bridge.receivedRequests).toHaveLength(1);
    expect(diagnostics).toContainEqual({
      message: "Bridge handshake completed.",
      details: {
        bridgeVersion: "fake-bridge-1.0.0",
        toolDefsVersion: "0.1.0",
      },
    });
  });

  it("accepts unknown fields on hello and response frames", async () => {
    const bridge = await startBridge({
      hello: { capabilities: ["events"] },
      responses: [
        {
          kind: "success",
          payload: { ok: true },
          responseExtras: { duration_ms: 5 },
        },
      ],
    });
    const client = createClient(bridge.socketPath);

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
  });

  it("queues concurrent requests until the hello handshake completes", async () => {
    const bridge = await startBridge({ helloDelayMs: 20 });
    const client = createClient(bridge.socketPath);

    const results = await Promise.all([
      client.request({ tool: "stub.echo", args: { id: 1 }, timeoutMs: 100 }),
      client.request({ tool: "stub.echo", args: { id: 2 }, timeoutMs: 100 }),
    ]);

    expect(results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(bridge.receivedRequests.map((request) => request.args)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("times out a missing hello and reconnects on the next request", async () => {
    const bridge = await startBridge({
      connections: ["no-hello", "normal"],
      responses: [{ kind: "success", payload: { recovered: true } }],
    });
    const client = createClient(bridge.socketPath, {
      handshakeTimeoutMs: 20,
    });

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      code: "NOT_SENT",
      message: "Bridge handshake timed out after 20ms.",
    });
    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ recovered: true });
    expect(bridge.connectionCount).toBe(2);
  });

  it("times out when the socket connect callback never arrives", async () => {
    let connectCalls = 0;
    const client = createClient("/unused/mie-bridge.sock", {
      handshakeTimeoutMs: 20,
      createSocket: () => {
        const socket = new Socket();
        socket.connect = (() => {
          connectCalls += 1;
          return socket;
        }) as Socket["connect"];
        return socket;
      },
    });

    await expect(
      client.request({ tool: "tabs_context", args: {}, timeoutMs: 100 }),
    ).rejects.toMatchObject({
      code: "NOT_SENT",
      message: "Bridge handshake timed out after 20ms.",
    });
    expect(connectCalls).toBe(1);
  });

  it("starts the fallback budget after a delayed handshake", async () => {
    const bridge = await startBridge({
      helloDelayMs: 50,
      responses: [{ kind: "success", payload: { ok: true }, delayMs: 5 }],
    });
    const client = createClient(bridge.socketPath, {
      fallbackGraceMs: 10,
      handshakeTimeoutMs: 100,
    });

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 10 }),
    ).resolves.toEqual({ ok: true });
  });

  it("times out buffered writes whose callbacks never flush", async () => {
    const bridge = await startBridge({
      connections: ["pause-after-hello"],
    });
    const client = createClient(bridge.socketPath, {
      fallbackGraceMs: 20,
      handshakeTimeoutMs: 100,
    });
    const requests = Array.from({ length: 300 }, (_, index) =>
      client.request({
        tool: "computer",
        args: { index, text: "x".repeat(250) },
        timeoutMs: 10,
      }),
    );
    const startedAt = Date.now();

    const results = await Promise.allSettled(requests);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(results).toHaveLength(300);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        code: "TIMEOUT",
      });
    }
  });

  it("continues when the diagnostic callback throws", async () => {
    const bridge = await startBridge();
    const client = createClient(bridge.socketPath, {
      onDiagnostic: () => {
        throw new Error("Diagnostic callback failed.");
      },
    });

    await expect(
      client.request({ tool: "stub.echo", args: { ok: true }, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
  });

  it("reports a tool definitions version mismatch without rejecting", async () => {
    const bridge = await startBridge();
    const diagnostics: BridgeDiagnostic[] = [];
    const client = createClient(bridge.socketPath, {
      expectedToolDefsVersion: "expected-tools",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({});
    expect(diagnostics).toContainEqual({
      message: "Bridge tool definitions version mismatch.",
      details: {
        actual: "0.1.0",
        expected: "expected-tools",
      },
    });
  });

  it("maps a missing socket to BRIDGE_NOT_RUNNING", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mie-mcp-missing-"));
    tempDirectories.push(directory);
    const client = createClient(resolveBridgeSocketPath(directory));

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 100 })
      .then(
        () => expect.unreachable("Expected request to fail."),
        (error: unknown) => expectBridgeError(error, "BRIDGE_NOT_RUNNING"),
      );
  });

  it("rejects an incompatible hello with both protocol versions", async () => {
    const bridge = await startBridge({ hello: { protocol_version: 2 } });
    const client = createClient(bridge.socketPath);

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 100 })
      .then(
        () => expect.unreachable("Expected request to fail."),
        (error: unknown) => {
          expectBridgeError(error, "NOT_SENT");
          expect((error as Error).message).toContain("2");
          expect((error as Error).message).toContain("1");
        },
      );
  });

  it("falls back to TIMEOUT and ignores a late response", async () => {
    const bridge = await startBridge({
      responses: [
        { kind: "success", payload: { late: true }, delayMs: 50 },
        { kind: "success", payload: { next: true } },
      ],
    });
    const client = createClient(bridge.socketPath, { fallbackGraceMs: 10 });

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 10 })
      .then(
        () => expect.unreachable("Expected request to time out."),
        (error: unknown) => expectBridgeError(error, "TIMEOUT"),
      );
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ next: true });
  });

  it("settles from a bridge TIMEOUT response and clears the fallback", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "error",
          error: { code: "TIMEOUT", message: "Bridge reported timeout." },
          responseExtras: { duration_ms: 5 },
        },
        { kind: "success", payload: { next: true } },
      ],
    });
    const client = createClient(bridge.socketPath, { fallbackGraceMs: 10 });

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 10 })
      .then(
        () => expect.unreachable("Expected request to time out."),
        (error: unknown) => {
          expectBridgeError(error, "TIMEOUT");
          expect((error as Error).message).toBe("Bridge reported timeout.");
        },
      );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ next: true });
  });

  it("ignores an event frame and processes the following response", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "success",
          payload: { ok: true },
          beforeResponseFrames: [{ type: "event", topic: "tab.changed" }],
        },
      ],
    });
    const client = createClient(bridge.socketPath);

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
  });

  it("settles an attributable malformed response immediately", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "malformed",
          createFrame: (request) => ({
            id: request.id,
            type: "tool_response",
            error: {},
          }),
        },
      ],
    });
    const client = createClient(bridge.socketPath);
    const startedAt = Date.now();

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: "Bridge response failed protocol validation.",
    });
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("drops an unattributable invalid frame and preserves other requests", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "success",
          payload: { ok: true },
          beforeResponseFrames: [
            { id: "unknown", type: "tool_response", error: {} },
          ],
        },
      ],
    });
    const client = createClient(bridge.socketPath);

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
  });

  it("does not include invalid frame content in diagnostics", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "malformed",
          createFrame: (request) => ({
            id: request.id,
            type: "tool_response",
            error: {},
            secret: "recognizable-sensitive-marker",
          }),
        },
      ],
    });
    const diagnostics: BridgeDiagnostic[] = [];
    const client = createClient(bridge.socketPath, {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "TOOL_ERROR" });
    expect(JSON.stringify(diagnostics)).not.toContain(
      "recognizable-sensitive-marker",
    );
  });

  it("keeps explicit false diagnostics identical to the default", async () => {
    const defaultDiagnostics = await collectInvalidFrameDiagnostics();
    const falseDiagnostics = await collectInvalidFrameDiagnostics(false);

    expect(falseDiagnostics).toEqual(defaultDiagnostics);
    expect(JSON.stringify(falseDiagnostics)).not.toContain("frameContent");
  });

  it.each(["private-marker", `private-marker${"你".repeat(4_000)}`])(
    "keeps verbose diagnostics identical to default diagnostics",
    async (marker) => {
      const enabled = await collectInvalidFrameDiagnostics(true, marker);
      const defaults = await collectInvalidFrameDiagnostics(undefined, marker);

      expect(enabled).toEqual(defaults);
      expect(JSON.stringify(enabled)).not.toContain("private-marker");
    },
  );

  it("settles an attributable oversized response immediately", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "success",
          payload: { data: "x".repeat(200_000) },
        },
      ],
    });
    const client = createClient(bridge.socketPath, {
      maxBufferBytes: 4_096,
    });
    const startedAt = Date.now();

    await expect(
      client.request({ tool: "read_page", args: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: "Bridge response exceeded the maximum frame size.",
    });
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("drops an unattributable oversized response before a valid one", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "success",
          payload: { ok: true },
          beforeResponseFrames: [
            {
              id: "unknown-request",
              type: "tool_response",
              payload: { data: "x".repeat(200_000) },
            },
          ],
        },
      ],
    });
    const client = createClient(bridge.socketPath, {
      maxBufferBytes: 4_096,
    });

    await expect(
      client.request({ tool: "tabs_context", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true });
  });

  it("preserves an unknown bridge error code", async () => {
    const bridge = await startBridge({
      responses: [
        {
          kind: "error",
          error: { code: "FUTURE_ERROR", message: "Future failure." },
        },
      ],
    });
    const client = createClient(bridge.socketPath);

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 100 })
      .then(
        () => expect.unreachable("Expected request to fail."),
        (error: unknown) => expectBridgeError(error, "FUTURE_ERROR"),
      );
  });

  it("returns NOT_SENT when the link closes before a request is written", async () => {
    const bridge = await startBridge({
      connections: ["disconnect-before-hello"],
    });
    const client = createClient(bridge.socketPath);

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 100 })
      .then(
        () => expect.unreachable("Expected request to fail."),
        (error: unknown) => expectBridgeError(error, "NOT_SENT"),
      );
  });

  it("returns SENT_LINK_LOST when the link closes after write callback", async () => {
    const bridge = await startBridge({
      responses: [{ kind: "disconnect-after-write" }],
    });
    const client = createClient(bridge.socketPath);

    await client
      .request({ tool: "stub.echo", args: {}, timeoutMs: 100 })
      .then(
        () => expect.unreachable("Expected request to fail."),
        (error: unknown) => expectBridgeError(error, "SENT_LINK_LOST"),
      );
  });

  it("returns SENT_LINK_LOST when close follows an acknowledged write", async () => {
    const bridge = await startBridge({
      responses: [{ kind: "silent" }],
    });
    const client = createClient(bridge.socketPath);
    const request = client.request({
      tool: "stub.echo",
      args: {},
      timeoutMs: 1_000,
    });

    await waitForRequests(bridge, 1);
    client.close();

    await expect(request).rejects.toMatchObject({ code: "SENT_LINK_LOST" });
  });

  it("treats shutdown before the write callback as SENT_LINK_LOST", async () => {
    const bridge = await startBridge({
      connections: ["pause-after-hello"],
    });
    let resolveWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      resolveWriteStarted = resolve;
    });
    let writeCalls = 0;
    let writeCallbacks = 0;
    let writeReturnValue: boolean | undefined;
    const client = createClient(bridge.socketPath, {
      fallbackGraceMs: 5_000,
      handshakeTimeoutMs: 500,
      createSocket: () => {
        const socket = new Socket();
        // Socket.connect restores write overrides before this event fires.
        socket.once("connect", () => {
          const write = socket.write.bind(socket);
          Object.defineProperty(socket, "write", {
            configurable: true,
            value: (
              chunk: Uint8Array | string,
              callback?: (error?: Error | null) => void,
            ): boolean => {
              writeCalls += 1;
              const result = write(chunk, (error?: Error | null) => {
                writeCallbacks += 1;
                callback?.(error);
              });
              writeReturnValue = result;
              resolveWriteStarted();
              return result;
            },
            writable: true,
          });
        });
        return socket;
      },
    });
    const request = client.request({
      tool: "computer",
      args: { action: "type", blob: "x".repeat(2 * 1024 * 1024) },
      timeoutMs: 5_000,
    });

    await withTimeout(writeStarted, 1_000, "large socket write");
    expect(writeCalls).toBe(1);
    expect(writeReturnValue).toBe(false);
    expect(writeCallbacks).toBe(0);
    client.close();

    await expect(request).rejects.toMatchObject({ code: "SENT_LINK_LOST" });
  });

  it("uses a unique request prefix for each client instance", async () => {
    const bridge = await startBridge();
    const first = new BridgeClient({
      socketPath: bridge.socketPath,
      onDiagnostic: () => {},
    });
    const second = new BridgeClient({
      socketPath: bridge.socketPath,
      onDiagnostic: () => {},
    });
    clients.push(first, second);

    await Promise.all([
      first.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
      second.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ]);

    expect(bridge.receivedRequests).toHaveLength(2);
    expect(bridge.receivedRequests[0]?.id).not.toBe(
      bridge.receivedRequests[1]?.id,
    );
  });

  it("rejects requests after the client has been closed", async () => {
    const bridge = await startBridge();
    const client = createClient(bridge.socketPath);

    client.close();

    await expect(
      client.request({ tool: "tabs_context", args: {}, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "NOT_SENT" });
    expect(bridge.connectionCount).toBe(0);
  });

  it("reconnects and handshakes on the next request", async () => {
    const bridge = await startBridge({
      responses: [
        { kind: "disconnect-after-write" },
        { kind: "success", payload: { recovered: true } },
      ],
    });
    const client = createClient(bridge.socketPath);

    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "SENT_LINK_LOST" });
    await expect(
      client.request({ tool: "stub.echo", args: {}, timeoutMs: 100 }),
    ).resolves.toEqual({ recovered: true });
  });
});
