import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { BridgeConnection } from "./bridge-connection.js";
import { summarizeValidationError } from "./bridge-diagnostics.js";
import { BridgeError } from "./bridge-error.js";
import { createDeferred, type Deferred } from "./deferred.js";
import { encodeFrame } from "./framing.js";
import {
  type BridgeErrorPayload,
  type ProfileIdentity,
  type ToolRequestFrame,
  type ToolResponseFrame,
} from "./protocol.js";

const InvalidResponseIdentitySchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("tool_response"),
});

export interface BridgeRequestInput {
  tool: string;
  args: unknown;
  timeoutMs: number;
  expectedProfile?: ProfileIdentity | undefined;
}

export interface PendingBridgeRequest {
  id: string;
  frame: ToolRequestFrame;
  deferred: Deferred<unknown>;
  timer: NodeJS.Timeout | undefined;
  connection: BridgeConnection | undefined;
  writeMayHaveBeenSent: boolean;
}

export class BridgeRequestManager {
  private readonly pending = new Map<string, PendingBridgeRequest>();
  private readonly requestPrefix: string;
  private sequence = 0;

  constructor(
    private readonly fallbackGraceMs: number,
    requestPrefix?: string,
  ) {
    this.requestPrefix = requestPrefix ?? randomUUID();

    if (!Number.isInteger(fallbackGraceMs) || fallbackGraceMs < 0) {
      throw new TypeError("The fallback grace must be a non-negative integer.");
    }
  }

  create(input: BridgeRequestInput): PendingBridgeRequest {
    const id = `${this.requestPrefix}-${++this.sequence}`;
    const deferred = createDeferred<unknown>();
    const pending: PendingBridgeRequest = {
      id,
      frame: {
        id,
        type: "tool_request",
        tool: input.tool,
        args: input.args,
        timeout_ms: input.timeoutMs,
        ...(input.expectedProfile === undefined
          ? {} : { expectedProfile: input.expectedProfile }),
      },
      deferred,
      timer: undefined,
      connection: undefined,
      writeMayHaveBeenSent: false,
    };
    this.pending.set(id, pending);
    return pending;
  }

  has(pending: PendingBridgeRequest): boolean {
    return this.pending.has(pending.id);
  }

  assignConnection(
    pending: PendingBridgeRequest,
    connection: BridgeConnection,
  ): void {
    pending.connection = connection;
  }

  write(
    connection: BridgeConnection,
    pending: PendingBridgeRequest,
  ): void {
    try {
      connection.write(encodeFrame(pending.frame), (error) => {
        if (!this.pending.has(pending.id)) {
          return;
        }

        if (error !== undefined && error !== null) {
          this.reject(
            pending,
            new BridgeError("NOT_SENT", "Bridge request was not sent.", error),
          );
          return;
        }
      });
      pending.writeMayHaveBeenSent = true;
      this.startFallbackTimer(pending);
    } catch (error) {
      this.reject(
        pending,
        new BridgeError("NOT_SENT", "Bridge request was not sent.", error),
      );
    }
  }

  handleResponse(frame: ToolResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (pending === undefined) {
      return;
    }

    if (isErrorResponse(frame)) {
      const message = frame.error.message ?? `Bridge returned ${frame.error.code}.`;
      this.reject(
        pending,
        new BridgeError(frame.error.code, message, frame.error),
      );
      return;
    }

    this.resolve(pending, frame.payload);
  }

  rejectAttributedInvalidResponse(
    rawFrame: unknown,
    validationError: z.ZodError,
  ): void {
    const identity = InvalidResponseIdentitySchema.safeParse(rawFrame);
    if (!identity.success) {
      return;
    }

    const pending = this.pending.get(identity.data.id);
    if (pending === undefined) {
      return;
    }

    this.reject(
      pending,
      new BridgeError(
        "TOOL_ERROR",
        "Bridge response failed protocol validation.",
        { issues: summarizeValidationError(validationError) },
      ),
    );
  }

  rejectOversizedResponse(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      return;
    }

    this.reject(
      pending,
      new BridgeError(
        "TOOL_ERROR",
        "Bridge response exceeded the maximum frame size.",
      ),
    );
  }

  rejectConnection(
    connection: BridgeConnection,
    terminalError: BridgeError | undefined,
  ): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.connection !== connection) {
        continue;
      }

      this.reject(
        pending,
        terminalError ?? this.createDeliveryError(pending),
      );
    }
  }

  closeAll(): void {
    for (const pending of [...this.pending.values()]) {
      this.reject(pending, this.createDeliveryError(pending));
    }
  }

  reject(pending: PendingBridgeRequest, error: BridgeError): void {
    if (!this.pending.delete(pending.id)) {
      return;
    }

    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pending.deferred.reject(error);
  }

  createDeliveryError(pending: PendingBridgeRequest): BridgeError {
    return pending.writeMayHaveBeenSent
      ? new BridgeError(
          "SENT_LINK_LOST",
          "Bridge link was lost after the request was sent.",
        )
      : new BridgeError("NOT_SENT", "Bridge request was not sent.");
  }

  private handleFallbackTimeout(id: string): void {
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }

    this.reject(
      pending,
      new BridgeError("TIMEOUT", "Bridge request fallback timeout expired."),
    );
  }

  private resolve(pending: PendingBridgeRequest, payload: unknown): void {
    if (!this.pending.delete(pending.id)) {
      return;
    }

    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pending.deferred.resolve(payload);
  }

  private startFallbackTimer(pending: PendingBridgeRequest): void {
    if (pending.timer !== undefined || !this.pending.has(pending.id)) {
      return;
    }

    pending.timer = setTimeout(
      () => this.handleFallbackTimeout(pending.id),
      pending.frame.timeout_ms + this.fallbackGraceMs,
    );
  }
}

function isErrorResponse(
  frame: ToolResponseFrame,
): frame is ToolResponseFrame & { error: BridgeErrorPayload } {
  return "error" in frame;
}
