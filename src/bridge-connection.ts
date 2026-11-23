import { Socket } from "node:net";

import { BridgeError } from "./bridge-error.js";
import { createDeferred, type Deferred } from "./deferred.js";
import { LineJsonDecoder } from "./framing.js";
import type { HelloFrame, ProfileIdentity } from "./protocol.js";

export interface BridgeHandshakeInfo {
  bridgeVersion: string;
  toolDefsVersion: string;
  profile?: ProfileIdentity;
}

export interface BridgeConnectionOptions {
  socketPath: string;
  supportedProtocolVersion: number;
  handshakeTimeoutMs: number;
  maxBufferBytes: number;
  expectedToolDefsVersion: string | undefined;
  createSocket: () => Socket;
  onFrame: (connection: BridgeConnection, frame: unknown) => void;
  onOversizedResponse: (requestId: string) => void;
  onClosed: (connection: BridgeConnection) => void;
  report: (message: string, details?: unknown) => void;
}

export class BridgeConnection {
  private readonly socket: Socket;
  private readonly decoder: LineJsonDecoder;
  private readonly handshake: Deferred<void> = createDeferred<void>();
  private handshakeInfo: BridgeHandshakeInfo | undefined;
  private terminalError: BridgeError | undefined;
  private handshakeTimer: NodeJS.Timeout | undefined;
  private connected = false;
  private closed = false;

  constructor(private readonly options: BridgeConnectionOptions) {
    const socket = options.createSocket();
    if (!(socket instanceof Socket)) {
      throw new TypeError("The socket factory must return a Socket instance.");
    }

    this.socket = socket;
    this.decoder = new LineJsonDecoder({
      onFrame: (frame) => options.onFrame(this, frame),
      onDiagnostic: (diagnostic) =>
        options.report(diagnostic.message, diagnostic.details),
      onOversizedResponse: options.onOversizedResponse,
      maxBufferBytes: options.maxBufferBytes,
    });
  }

  start(): void {
    this.socket.on("connect", () => {
      this.connected = true;
    });
    this.socket.on("data", (chunk) => this.handleSocketData(chunk));
    this.socket.on("error", (error) => this.handleSocketError(error));
    this.socket.on("close", () => this.handleSocketClose());
    this.handshakeTimer = setTimeout(
      () => this.handleHandshakeTimeout(),
      this.options.handshakeTimeoutMs,
    );
    this.socket.connect(this.options.socketPath);
  }

  waitForHandshake(): Promise<void> {
    return this.handshake.promise;
  }

  getHandshakeInfo(): BridgeHandshakeInfo | undefined {
    return this.handshakeInfo;
  }

  getTerminalError(): BridgeError | undefined {
    return this.terminalError;
  }

  isClosed(): boolean {
    return this.closed;
  }

  write(
    frame: string,
    callback: (error?: Error | null) => void,
  ): boolean {
    return this.socket.write(frame, callback);
  }

  close(): void {
    this.socket.destroy();
  }

  handleHello(frame: HelloFrame): void {
    if (this.handshakeInfo !== undefined || this.handshake.settled) {
      this.options.report("Ignored duplicate bridge hello frame.");
      return;
    }

    if (frame.protocol_version !== this.options.supportedProtocolVersion) {
      const error = new BridgeError(
        "NOT_SENT",
        `Unsupported bridge protocol version ${frame.protocol_version}; ` +
          `supported version is ${this.options.supportedProtocolVersion}.`,
      );
      this.terminalError = error;
      this.handshake.reject(error);
      this.socket.destroy();
      return;
    }

    this.handshakeInfo = {
      bridgeVersion: frame.bridge_version,
      toolDefsVersion: frame.tool_defs_version,
      ...(frame.profile === undefined ? {} : { profile: frame.profile }),
    };
    this.clearHandshakeTimer();
    this.options.report("Bridge handshake completed.", this.handshakeInfo);
    if (
      this.options.expectedToolDefsVersion !== undefined &&
      frame.tool_defs_version !== this.options.expectedToolDefsVersion
    ) {
      this.options.report("Bridge tool definitions version mismatch.", {
        actual: frame.tool_defs_version,
        expected: this.options.expectedToolDefsVersion,
      });
    }
    this.handshake.resolve();
  }

  private handleSocketError(error: Error): void {
    this.options.report("Bridge socket error.", error);

    if (this.connected) {
      return;
    }

    const code = (error as NodeJS.ErrnoException).code;
    this.terminalError =
      code === "ENOENT" || code === "ECONNREFUSED"
        ? new BridgeError(
            "BRIDGE_NOT_RUNNING",
            "Bridge is not running.",
            error,
          )
        : new BridgeError("NOT_SENT", "Bridge connection failed.", error);
    this.handshake.reject(this.terminalError);
  }

  private handleSocketClose(): void {
    this.closed = true;
    this.clearHandshakeTimer();
    const handshakeError =
      this.terminalError ??
      new BridgeError("NOT_SENT", "Bridge disconnected before handshake.");
    this.handshake.reject(handshakeError);
    // onClosed must finish synchronously before handshake continuations run.
    this.options.onClosed(this);
  }

  private handleHandshakeTimeout(): void {
    if (this.closed || this.handshake.settled) {
      return;
    }

    const error = new BridgeError(
      "NOT_SENT",
      `Bridge handshake timed out after ${this.options.handshakeTimeoutMs}ms.`,
    );
    this.terminalError = error;
    this.socket.destroy();
  }

  private handleSocketData(chunk: Buffer | string): void {
    try {
      this.decoder.push(chunk);
    } catch (error) {
      this.options.report("Bridge data handler failed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== undefined) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
  }
}
