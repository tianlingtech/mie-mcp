import { describe, expect, it, vi } from "vitest";

import {
  encodeFrame,
  extractOversizedResponseId,
  LineJsonDecoder,
} from "../src/framing.js";

function createDecoder(): {
  decoder: LineJsonDecoder;
  frames: unknown[];
  diagnostics: unknown[];
} {
  const frames: unknown[] = [];
  const diagnostics: unknown[] = [];
  const decoder = new LineJsonDecoder({
    onFrame: (frame) => frames.push(frame),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { decoder, frames, diagnostics };
}

describe("LineJsonDecoder", () => {
  it("decodes multiple frames from one chunk", () => {
    const { decoder, frames, diagnostics } = createDecoder();

    decoder.push('{"id":1}\n{"id":2}\n');

    expect(frames).toEqual([{ id: 1 }, { id: 2 }]);
    expect(diagnostics).toEqual([]);
  });

  it("joins a frame split across chunks", () => {
    const { decoder, frames } = createDecoder();

    decoder.push(Buffer.from('{"message":"你'));
    decoder.push(Buffer.from('好"}\n'));

    expect(frames).toEqual([{ message: "你好" }]);
  });

  it("reports an invalid line and continues with later frames", () => {
    const { decoder, frames, diagnostics } = createDecoder();

    decoder.push('not-json\n{"valid":true}\n');

    expect(frames).toEqual([{ valid: true }]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: "Discarded invalid JSON frame.",
        details: {
          length: 8,
          prefixHash: expect.stringMatching(/^[a-f0-9]{16}$/),
        },
      }),
    ]);
  });

  it("discards an oversized incomplete line and accepts later frames", () => {
    const frames: unknown[] = [];
    const diagnostics: unknown[] = [];
    const decoder = new LineJsonDecoder({
      onFrame: (frame) => frames.push(frame),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      maxBufferBytes: 10,
    });

    decoder.push("sensitive-marker");
    decoder.push('\n{"ok":1}\n');

    expect(frames).toEqual([{ ok: 1 }]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: "Discarded oversized incomplete JSON frame.",
        details: { length: 16, prefixHash: expect.any(String) },
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive-marker");
  });

  it("extracts a pending id from fragmented oversized input", () => {
    const requestIds: string[] = [];
    const parse = vi.spyOn(JSON, "parse");
    const decoder = new LineJsonDecoder({
      onFrame: () => {},
      onDiagnostic: () => {},
      onOversizedResponse: (requestId) => requestIds.push(requestId),
      maxBufferBytes: 4_096,
    });
    const line = JSON.stringify({
      id: "request-1",
      type: "tool_response",
      payload: "x".repeat(20_000),
    });

    try {
      const encoded = `${line}\n`;
      for (let offset = 0; offset < encoded.length; offset += 8_192) {
        decoder.push(encoded.slice(offset, offset + 8_192));
      }
      expect(requestIds).toEqual(["request-1"]);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("does not scan for an id beyond the bounded prefix", () => {
    const line = `${"x".repeat(600)}"id":"late","type":"tool_response"`;

    expect(extractOversizedResponseId(line)).toBeUndefined();
  });

  it("extracts an id regardless of top-level key order", () => {
    const line =
      '{"type":"tool_response","future":true,"id":"request-1"}';

    expect(extractOversizedResponseId(line)).toBe("request-1");
  });

  it("does not misreport an onFrame exception as invalid JSON", () => {
    const diagnostics: unknown[] = [];
    const decoder = new LineJsonDecoder({
      onFrame: () => {
        throw new TypeError("Frame handler failed.");
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(() => decoder.push('{"valid":true}\n')).toThrow(
      "Frame handler failed.",
    );
    expect(diagnostics).toEqual([]);
  });

  it("invokes frame delivery synchronously", () => {
    const order = ["before"];
    const decoder = new LineJsonDecoder({
      onFrame: () => order.push("frame"),
      onDiagnostic: () => {},
    });

    decoder.push('{"ok":true}\n');
    order.push("after");

    expect(order).toEqual(["before", "frame", "after"]);
  });

  it("invokes oversized response delivery synchronously", () => {
    const order = ["before"];
    const decoder = new LineJsonDecoder({
      onFrame: () => {},
      onDiagnostic: () => {},
      onOversizedResponse: () => order.push("oversized"),
      maxBufferBytes: 64,
    });
    const line = JSON.stringify({
      id: "request-1",
      type: "tool_response",
      payload: "x".repeat(128),
    });

    decoder.push(`${line}\n`);
    order.push("after");

    expect(order).toEqual(["before", "oversized", "after"]);
  });

  it.each([
    ["invalid JSON", "private-marker", "\n"],
    ["oversized line", "private-marker你".repeat(400), "\n"],
    ["oversized incomplete line", "private-marker你".repeat(400), ""],
  ])("reports only a fingerprint for %s in verbose mode", (_, line, end) => {
    const onDiagnostic = vi.fn();
    const decoder = new LineJsonDecoder({
      onFrame: () => {},
      onDiagnostic,
      maxBufferBytes: 64,
      verboseDiagnostics: true,
    });

    decoder.push(line + end);

    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({
      message: expect.any(String),
      details: {
        length: Buffer.byteLength(line),
        prefixHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      },
    });
  });
});

describe("encodeFrame", () => {
  it("encodes one JSON object followed by a newline", () => {
    expect(encodeFrame({ ok: true })).toBe('{"ok":true}\n');
  });
});
