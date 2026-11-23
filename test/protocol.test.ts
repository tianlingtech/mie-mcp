import { describe, expect, it } from "vitest";

import { ToolResponseFrameSchema } from "../src/protocol.js";

const RESPONSE_BASE = {
  id: "request-1",
  type: "tool_response" as const,
};

describe("ToolResponseFrameSchema", () => {
  it("accepts unknown fields on valid success and error responses", () => {
    expect(
      ToolResponseFrameSchema.safeParse({
        ...RESPONSE_BASE,
        payload: { ok: true },
        duration_ms: 5,
      }).success,
    ).toBe(true);
    expect(
      ToolResponseFrameSchema.safeParse({
        ...RESPONSE_BASE,
        error: {
          code: "TIMEOUT",
          data: { future_detail: true },
          retry_after_ms: 10,
        },
        retriable: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    {},
    "boom",
    null,
    { code: 123 },
    { code: "" },
  ])("rejects a malformed error payload: %j", (error) => {
    expect(
      ToolResponseFrameSchema.safeParse({
        ...RESPONSE_BASE,
        error,
      }).success,
    ).toBe(false);
  });

  it("rejects responses with both or neither result key", () => {
    expect(ToolResponseFrameSchema.safeParse(RESPONSE_BASE).success).toBe(false);
    expect(
      ToolResponseFrameSchema.safeParse({
        ...RESPONSE_BASE,
        payload: { ok: true },
        error: { code: "TOOL_ERROR" },
      }).success,
    ).toBe(false);
  });
});
