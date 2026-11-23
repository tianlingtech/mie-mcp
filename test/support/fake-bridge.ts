import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { encodeFrame, LineJsonDecoder } from "../../src/framing.js";
import {
  HelloFrameSchema,
  ToolRequestFrameSchema,
  type BridgeErrorPayload,
  type HelloFrame,
  type ToolRequestFrame,
} from "../../src/protocol.js";
import { resolveBridgeSocketPath } from "../../src/socket-path.js";

interface FakeResponseOptions {
  delayMs?: number;
  beforeResponseFrames?: readonly unknown[];
  responseExtras?: Readonly<Record<string, unknown>>;
}

export type FakeResponsePlan =
  | ({ kind: "success"; payload: unknown } & FakeResponseOptions)
  | ({ kind: "error"; error: BridgeErrorPayload } & FakeResponseOptions)
  | ({
      kind: "malformed";
      createFrame: (request: ToolRequestFrame) => unknown;
    } & FakeResponseOptions)
  | { kind: "silent" }
  | { kind: "disconnect-after-write"; delayMs?: number };

export type FakeConnectionPlan =
  | "normal"
  | "disconnect-before-hello"
  | "no-hello"
  | "pause-after-hello";

export interface FakeBridgeOptions {
  hello?: Partial<HelloFrame> & Record<string, unknown>;
  helloDelayMs?: number;
  responses?: readonly FakeResponsePlan[];
  connections?: readonly FakeConnectionPlan[];
}

export interface FakeBridgeDiagnostic {
  message: string;
  details: unknown;
}

const DEFAULT_HELLO: HelloFrame = {
  type: "hello",
  protocol_version: 1,
  bridge_version: "fake-bridge-1.0.0",
  tool_defs_version: "0.1.0",
};

export class FakeBridge {
  readonly receivedRequests: ToolRequestFrame[] = [];
  readonly diagnostics: FakeBridgeDiagnostic[] = [];
  connectionCount = 0;

  private readonly sockets = new Set<Socket>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly responses: FakeResponsePlan[];
  private readonly connections: FakeConnectionPlan[];

  private constructor(
    readonly tempDirectory: string,
    readonly socketPath: string,
    private readonly server: Server,
    private readonly hello: HelloFrame,
    private readonly helloDelayMs: number,
    options: FakeBridgeOptions,
  ) {
    this.responses = [...(options.responses ?? [])];
    this.connections = [...(options.connections ?? [])];
  }

  static async start(options: FakeBridgeOptions = {}): Promise<FakeBridge> {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mie-mcp-fake-"));
    const socketPath = resolveBridgeSocketPath(tempDirectory);
    const hello = HelloFrameSchema.parse({ ...DEFAULT_HELLO, ...options.hello });
    const helloDelayMs = options.helloDelayMs ?? 0;

    if (!Number.isInteger(helloDelayMs) || helloDelayMs < 0) {
      await rm(tempDirectory, { recursive: true, force: true });
      throw new TypeError("The fake bridge hello delay must be non-negative.");
    }

    await mkdir(dirname(socketPath), { recursive: true });
    const server = createServer();
    const bridge = new FakeBridge(
      tempDirectory,
      socketPath,
      server,
      hello,
      helloDelayMs,
      options,
    );
    server.on("connection", (socket) => bridge.handleConnection(socket));
    await bridge.listen();
    return bridge;
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    }

    await rm(this.tempDirectory, { recursive: true, force: true });
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error): void => {
        this.server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = (): void => {
        this.server.off("error", handleError);
        resolve();
      };

      this.server.once("error", handleError);
      this.server.once("listening", handleListening);
      this.server.listen(this.socketPath);
    });
  }

  private handleConnection(socket: Socket): void {
    this.connectionCount += 1;
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.on("error", (error) => {
      this.diagnostics.push({
        message: "Fake bridge socket error.",
        details: { name: error.name },
      });
    });

    const connectionPlan = this.connections.shift() ?? "normal";
    if (connectionPlan === "disconnect-before-hello") {
      this.schedule(() => socket.destroy(), 0);
      return;
    }

    const decoder = new LineJsonDecoder({
      onFrame: (frame) => this.handleRequest(socket, frame),
      onDiagnostic: (diagnostic) => {
        this.diagnostics.push({
          message: diagnostic.message,
          details: diagnostic.details,
        });
      },
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    if (connectionPlan === "no-hello") {
      return;
    }
    if (connectionPlan === "pause-after-hello") {
      this.schedule(
        () => socket.write(encodeFrame(this.hello), () => socket.pause()),
        this.helloDelayMs,
      );
      return;
    }
    this.schedule(() => socket.write(encodeFrame(this.hello)), this.helloDelayMs);
  }

  private handleRequest(socket: Socket, rawFrame: unknown): void {
    const parsed = ToolRequestFrameSchema.safeParse(rawFrame);
    if (!parsed.success) {
      this.diagnostics.push({
        message: "Fake bridge received an invalid request frame.",
        details: { issueCount: parsed.error.issues.length },
      });
      return;
    }

    this.receivedRequests.push(parsed.data);
    const plan = this.responses.shift() ?? {
      kind: "success",
      payload: parsed.data.args,
    };
    this.applyResponsePlan(socket, parsed.data, plan);
  }

  private applyResponsePlan(
    socket: Socket,
    request: ToolRequestFrame,
    plan: FakeResponsePlan,
  ): void {
    if (plan.kind === "silent") {
      return;
    }

    if (plan.kind === "disconnect-after-write") {
      this.schedule(() => socket.destroy(), plan.delayMs ?? 10);
      return;
    }

    const frame =
      plan.kind === "malformed"
        ? plan.createFrame(request)
        : plan.kind === "success"
        ? {
            ...plan.responseExtras,
            id: request.id,
            type: "tool_response" as const,
            payload: plan.payload,
          }
        : {
            ...plan.responseExtras,
            id: request.id,
            type: "tool_response" as const,
            error: plan.error,
          };
    const response = [
      ...(plan.beforeResponseFrames ?? []).map(encodeFrame),
      encodeFrame(frame),
    ].join("");
    this.schedule(
      () => socket.write(response),
      plan.delayMs ?? 0,
    );
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delayMs);
    this.timers.add(timer);
  }
}
