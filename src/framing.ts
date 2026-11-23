import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
export const OVERSIZED_FRAME_PREFIX_LENGTH = 512;

export interface FrameFingerprint {
  length: number;
  prefixHash: string;
}

export interface FrameDiagnostic {
  message: string;
  details: FrameFingerprint;
}

export interface LineJsonDecoderOptions {
  onFrame: (frame: unknown) => void;
  onDiagnostic: (diagnostic: FrameDiagnostic) => void;
  onOversizedResponse?: (requestId: string) => void;
  maxBufferBytes?: number;
  verboseDiagnostics?: boolean;
}

export class LineJsonDecoder {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private bufferBytes = 0;
  private discardingOversizedLine = false;
  private readonly maxBufferBytes: number;

  constructor(private readonly options: LineJsonDecoderOptions) {
    this.maxBufferBytes =
      options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

    if (!Number.isInteger(this.maxBufferBytes) || this.maxBufferBytes <= 0) {
      throw new TypeError("The frame buffer limit must be a positive integer.");
    }
  }

  push(chunk: Buffer | string): void {
    let decoded =
      typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (this.discardingOversizedLine) {
      const newlineIndex = decoded.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      this.discardingOversizedLine = false;
      decoded = decoded.slice(newlineIndex + 1);
    }

    if (decoded.length === 0) {
      return;
    }

    this.buffer += decoded;
    this.bufferBytes += Buffer.byteLength(decoded);
    this.drainLines();
    this.discardOversizedBuffer();
  }

  private drainLines(): void {
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      const consumed = this.buffer.slice(0, newlineIndex + 1);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.bufferBytes -= Buffer.byteLength(consumed);

      if (Buffer.byteLength(line) > this.maxBufferBytes) {
        const requestId = extractOversizedResponseId(line);
        this.options.onDiagnostic({
          message: "Discarded oversized JSON frame.",
          details: createFrameFingerprint(line),
        });
        if (requestId !== undefined) {
          this.options.onOversizedResponse?.(requestId);
        }
      } else {
        this.parseLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private discardOversizedBuffer(): void {
    if (this.bufferBytes <= this.maxBufferBytes) {
      return;
    }

    const requestId = extractOversizedResponseId(this.buffer);
    this.options.onDiagnostic({
      message: "Discarded oversized incomplete JSON frame.",
      details: createFrameFingerprint(this.buffer),
    });
    if (requestId !== undefined) {
      this.options.onOversizedResponse?.(requestId);
    }
    this.buffer = "";
    this.bufferBytes = 0;
    this.discardingOversizedLine = true;
    this.decoder = new StringDecoder("utf8");
  }

  private parseLine(line: string): void {
    let frame: unknown;

    try {
      frame = JSON.parse(line);
    } catch {
      this.options.onDiagnostic({
        message: "Discarded invalid JSON frame.",
        details: createFrameFingerprint(line),
      });
      return;
    }

    this.options.onFrame(frame);
  }
}

export function createFrameFingerprint(content: string): FrameFingerprint {
  const prefix = Buffer.from(content).subarray(0, 1_024);

  return {
    length: Buffer.byteLength(content),
    prefixHash: createHash("sha256").update(prefix).digest("hex").slice(0, 16),
  };
}

export function extractOversizedResponseId(line: string): string | undefined {
  const prefix = line.slice(0, OVERSIZED_FRAME_PREFIX_LENGTH);
  if (!/"type"\s*:\s*"tool_response"/.test(prefix)) {
    return undefined;
  }

  return /"id"\s*:\s*"([A-Za-z0-9._:-]{1,200})"/.exec(prefix)?.[1];
}

export function encodeFrame(frame: unknown): string {
  const serialized = JSON.stringify(frame);

  if (serialized === undefined) {
    throw new TypeError("Frame is not JSON serializable.");
  }

  return `${serialized}\n`;
}
