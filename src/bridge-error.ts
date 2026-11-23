import type { BridgeErrorCode } from "./protocol.js";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly data: unknown;

  constructor(
    code: BridgeErrorCode,
    message: string,
    data?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BridgeError";
    this.code = code;
    this.data = data;
  }
}

export function asBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) {
    return error;
  }

  return new BridgeError("NOT_SENT", "Unexpected bridge client error.", error, {
    cause: error,
  });
}
