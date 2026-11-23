import { describe, expect, it } from "vitest";

import {
  fingerprintValue,
  MAX_VALIDATION_ISSUE_DEPTH,
  MAX_VALIDATION_ISSUES,
  selectFrameValidationError,
  summarizeValidationError,
  summarizeValidationIssues,
} from "../src/bridge-diagnostics.js";
import {
  IncomingFrameSchema,
  ToolResponseFrameSchema,
} from "../src/protocol.js";

const BASE = { id: "request-1", type: "tool_response" };

describe("bridge validation diagnostics", () => {
  it.each([
    [{ ...BASE, payload: {}, error: null }, "payload"],
    [{ ...BASE, payload: {}, error: { code: "TOOL_ERROR" } }, "payload"],
    [BASE, "payload"],
    [{ ...BASE, error: {} }, "code"],
    [{ ...BASE, id: 123, payload: {} }, "id"],
    [{ ...BASE, result: {} }, "payload"],
    [{ ...BASE, type: "future_response", payload: {} }, "type"],
  ])("summarizes union drift for %j", (frame, expectedIdentifier) => {
    const parsed = ToolResponseFrameSchema.safeParse(frame);
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    const summaries = summarizeValidationError(parsed.error);
    expect(JSON.stringify(summaries)).toContain(expectedIdentifier);
  });

  it("adds safe top-level protocol keys to the frame fingerprint", () => {
    expect(
      fingerprintValue({
        id: "request-1",
        type: "tool_response",
        result: { sensitive: "not-logged" },
        private_field_name: true,
      }),
    ).toMatchObject({
      length: expect.any(Number),
      prefixHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      topLevelKeys: ["id", "result", "type"],
    });
  });

  it("selects the tool response branch before expanding issues", () => {
    const frame = { ...BASE, error: {} };
    const parsed = IncomingFrameSchema.safeParse(frame);
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    const selected = selectFrameValidationError(frame, parsed.error);
    const summary = JSON.stringify(summarizeValidationError(selected));

    expect(summary).toContain("code");
    expect(summary).not.toContain("protocol_version");
    expect(summary).not.toContain("bridge_version");
  });

  it("bounds recursive issue depth", () => {
    const nested = createNestedUnionIssue(MAX_VALIDATION_ISSUE_DEPTH + 3);
    const summaries = summarizeValidationIssues([nested]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.code).toBe("truncated");
  });

  it("bounds the number of parallel issues", () => {
    const issues = Array.from({ length: MAX_VALIDATION_ISSUES + 10 }, (_, index) => ({
      code: "custom",
      message: `Issue ${index}.`,
      path: [index],
    }));
    const summaries = summarizeValidationIssues(issues);

    expect(summaries).toHaveLength(MAX_VALIDATION_ISSUES);
    expect(summaries.at(-1)?.code).toBe("truncated");
  });
});

function createNestedUnionIssue(depth: number): {
  code: string;
  message: string;
  path: PropertyKey[];
  errors?: ReturnType<typeof createNestedUnionIssue>[][];
} {
  if (depth === 0) {
    return { code: "custom", message: "Leaf issue.", path: ["leaf"] };
  }

  return {
    code: "invalid_union",
    message: "Invalid input.",
    path: [],
    errors: [[createNestedUnionIssue(depth - 1)]],
  };
}
