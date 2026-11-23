import { Socket } from "node:net";
import { z } from "zod";
import {
  ProfileIdentitySchema, ProfileNameSchema, sameProfile,
} from "@mie/tool-defs/profiles";

import {
  BridgeConnection,
  type BridgeHandshakeInfo,
} from "./bridge-connection.js";
import {
  fingerprintValue,
  selectFrameValidationError,
} from "./bridge-diagnostics.js";
import { asBridgeError, BridgeError } from "./bridge-error.js";
import {
  BridgeRequestManager,
  type PendingBridgeRequest,
} from "./bridge-request-manager.js";
import { DEFAULT_MAX_BUFFER_BYTES } from "./framing.js";
import {
  IncomingFrameSchema,
  SUPPORTED_PROTOCOL_VERSION,
  type ProfileIdentity,
} from "./protocol.js";
import { resolveBridgeSocketPath } from "./socket-path.js";

const DEFAULT_FALLBACK_GRACE_MS = 5_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

const BridgeRequestSchema = z.strictObject({
  tool: z.string().min(1),
  args: z.unknown(),
  timeoutMs: z.number().int().positive(),
  expectedProfile: ProfileIdentitySchema.optional(),
  profileName: ProfileNameSchema.optional(),
});

export interface BridgeRequest {
  tool: string;
  args: unknown;
  timeoutMs: number;
  expectedProfile?: ProfileIdentity;
  profileName?: string;
}

export type { BridgeHandshakeInfo } from "./bridge-connection.js";

export interface BridgeDiagnostic {
  message: string;
  details?: unknown;
}

export interface BridgeClientOptions {
  socketPath?: string;
  supportedProtocolVersion?: number;
  fallbackGraceMs?: number;
  handshakeTimeoutMs?: number;
  maxBufferBytes?: number;
  verboseDiagnostics?: boolean;
  requestPrefix?: string;
  expectedToolDefsVersion?: string;
  onDiagnostic?: (diagnostic: BridgeDiagnostic) => void;
  createSocket?: () => Socket;
}

export class BridgeClient {
  private readonly socketPath: string;
  private readonly supportedProtocolVersion: number;
  private readonly handshakeTimeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly expectedToolDefsVersion: string | undefined;
  private readonly onDiagnostic: (diagnostic: BridgeDiagnostic) => void;
  private readonly createSocket: () => Socket;
  private readonly requests: BridgeRequestManager;
  private connection: BridgeConnection | undefined;
  private closed = false;

  constructor(options: BridgeClientOptions = {}) {
    this.socketPath = options.socketPath ?? resolveBridgeSocketPath();
    this.supportedProtocolVersion =
      options.supportedProtocolVersion ?? SUPPORTED_PROTOCOL_VERSION;
    this.handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.expectedToolDefsVersion = options.expectedToolDefsVersion;
    this.createSocket = options.createSocket ?? (() => new Socket());
    this.onDiagnostic =
      options.onDiagnostic ??
      ((diagnostic) => {
        console.error(
          `[mie-mcp] ${diagnostic.message}`,
          diagnostic.details ?? "",
        );
      });
    this.requests = new BridgeRequestManager(
      options.fallbackGraceMs ?? DEFAULT_FALLBACK_GRACE_MS,
      options.requestPrefix,
    );

    if (
      !Number.isInteger(this.handshakeTimeoutMs) ||
      this.handshakeTimeoutMs <= 0
    ) {
      throw new TypeError("The handshake timeout must be a positive integer.");
    }

    if (!Number.isInteger(this.maxBufferBytes) || this.maxBufferBytes <= 0) {
      throw new TypeError("The frame buffer limit must be a positive integer.");
    }
  }

  request(input: BridgeRequest): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new BridgeError("NOT_SENT", "Bridge client is closed."),
      );
    }

    const parsed = BridgeRequestSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.reject(
        new BridgeError("NOT_SENT", "Invalid bridge request.", parsed.error),
      );
    }

    const pending = this.requests.create(parsed.data);
    void this.dispatch(pending, parsed.data.profileName);
    return pending.deferred.promise;
  }

  getHandshakeInfo(): BridgeHandshakeInfo | undefined {
    return this.connection?.getHandshakeInfo();
  }

  async connect(): Promise<BridgeHandshakeInfo> {
    const connection = this.getOrCreateConnection();
    await connection.waitForHandshake();
    const info = connection.getHandshakeInfo();
    if (connection.isClosed() || info === undefined) {
      throw connection.getTerminalError() ??
        new BridgeError("NOT_SENT", "Bridge connection closed during handshake.");
    }
    return info;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.connection?.close();
    this.requests.closeAll();
  }

  private async dispatch(
    pending: PendingBridgeRequest, profileName?: string,
  ): Promise<void> {
    try {
      const connection = this.getOrCreateConnection();
      this.requests.assignConnection(pending, connection);
      await connection.waitForHandshake();

      if (!this.requests.has(pending)) {
        return;
      }

      if (connection.isClosed() || this.connection !== connection) {
        throw (
          connection.getTerminalError() ??
          this.requests.createDeliveryError(pending)
        );
      }

      const expected = pending.frame.expectedProfile;
      const actual = connection.getHandshakeInfo()?.profile;
      if ((expected !== undefined &&
        (actual === undefined || !sameProfile(expected, actual))) ||
        (profileName !== undefined && actual !== undefined &&
          actual.name !== profileName)) {
        throw new BridgeError(
          "PROFILE_IDENTITY_MISMATCH", "Bridge profile identity changed.",
        );
      }
      this.requests.write(connection, pending);
    } catch (error) {
      this.requests.reject(pending, asBridgeError(error));
    }
  }

  private getOrCreateConnection(): BridgeConnection {
    if (this.closed) {
      throw new BridgeError("NOT_SENT", "Bridge client is closed.");
    }

    if (this.connection !== undefined && !this.connection.isClosed()) {
      return this.connection;
    }

    const connection = new BridgeConnection({
      socketPath: this.socketPath,
      supportedProtocolVersion: this.supportedProtocolVersion,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      maxBufferBytes: this.maxBufferBytes,
      expectedToolDefsVersion: this.expectedToolDefsVersion,
      createSocket: this.createSocket,
      onFrame: (source, frame) => this.handleFrame(source, frame),
      onOversizedResponse: (requestId) =>
        this.requests.rejectOversizedResponse(requestId),
      onClosed: (source) => this.handleConnectionClosed(source),
      report: (message, details) => this.report(message, details),
    });
    this.connection = connection;
    connection.start();
    return connection;
  }

  private handleFrame(
    connection: BridgeConnection,
    rawFrame: unknown,
  ): void {
    const parsed = IncomingFrameSchema.safeParse(rawFrame);
    if (!parsed.success) {
      const validationError = selectFrameValidationError(
        rawFrame,
        parsed.error,
      );
      this.report("Discarded invalid bridge protocol frame.", {
        ...fingerprintValue(rawFrame),
        issueCount: validationError.issues.length,
      });
      this.requests.rejectAttributedInvalidResponse(
        rawFrame,
        validationError,
      );
      return;
    }

    if (parsed.data.type === "hello") {
      connection.handleHello(parsed.data);
      return;
    }

    if (parsed.data.type === "event") {
      return;
    }

    this.requests.handleResponse(parsed.data);
  }

  private handleConnectionClosed(connection: BridgeConnection): void {
    if (this.connection === connection) {
      this.connection = undefined;
    }
    this.requests.rejectConnection(connection, connection.getTerminalError());
  }

  private report(message: string, details?: unknown): void {
    try {
      this.onDiagnostic(
        details === undefined ? { message } : { message, details },
      );
    } catch {
      return;
    }
  }
}
