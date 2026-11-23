import { z } from "zod";

import {
  createFrameFingerprint,
  type FrameFingerprint,
} from "./framing.js";
import {
  EventFrameSchema,
  HelloFrameSchema,
  ToolResponseFrameSchema,
} from "./protocol.js";

export const MAX_VALIDATION_ISSUE_DEPTH = 4;
export const MAX_VALIDATION_ISSUES = 32;

export interface ValidationIssueSummary {
  code: string;
  message: string;
  path: string[];
}

export interface ValueFingerprint extends FrameFingerprint {
  topLevelKeys?: string[];
}

interface IssueLike {
  code: string;
  message: string;
  path: PropertyKey[];
  errors?: IssueLike[][];
}

export function fingerprintValue(
  value: unknown,
): ValueFingerprint {
  const topLevelKeys = getSafeTopLevelKeys(value);

  try {
    return {
      ...createFrameFingerprint(
        JSON.stringify(value) ?? typeof value,
      ),
      ...(topLevelKeys.length === 0 ? {} : { topLevelKeys }),
    };
  } catch {
    return {
      ...createFrameFingerprint(typeof value),
      ...(topLevelKeys.length === 0 ? {} : { topLevelKeys }),
    };
  }
}

export function summarizeValidationError(
  error: z.ZodError,
): ValidationIssueSummary[] {
  return summarizeValidationIssues(error.issues as unknown as IssueLike[]);
}

export function selectFrameValidationError(
  frame: unknown,
  fallback: z.ZodError,
): z.ZodError {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
    return fallback;
  }

  const type = (frame as Record<string, unknown>)["type"];
  const schema =
    type === "hello"
      ? HelloFrameSchema
      : type === "tool_response"
        ? ToolResponseFrameSchema
        : type === "event"
          ? EventFrameSchema
          : undefined;
  if (schema === undefined) {
    return fallback;
  }

  const selected = schema.safeParse(frame);
  return selected.success ? fallback : selected.error;
}

export function summarizeValidationIssues(
  issues: IssueLike[],
): ValidationIssueSummary[] {
  const summaries: ValidationIssueSummary[] = [];
  const state = { truncated: false };
  collectIssueSummaries(issues, 0, summaries, state);

  if (state.truncated) {
    const marker: ValidationIssueSummary = {
      code: "truncated",
      message: "Additional validation issues were truncated.",
      path: [],
    };
    if (summaries.length >= MAX_VALIDATION_ISSUES) {
      summaries[MAX_VALIDATION_ISSUES - 1] = marker;
    } else {
      summaries.push(marker);
    }
  }

  return summaries;
}

function collectIssueSummaries(
  issues: IssueLike[],
  depth: number,
  summaries: ValidationIssueSummary[],
  state: { truncated: boolean },
): void {
  for (const issue of issues) {
    if (summaries.length >= MAX_VALIDATION_ISSUES) {
      state.truncated = true;
      return;
    }

    if (issue.code === "invalid_union" && Array.isArray(issue.errors)) {
      if (depth >= MAX_VALIDATION_ISSUE_DEPTH) {
        state.truncated = true;
        continue;
      }
      for (const branch of issue.errors) {
        collectIssueSummaries(branch, depth + 1, summaries, state);
      }
      continue;
    }

    summaries.push({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    });
  }
}

function getSafeTopLevelKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const protocolKeys = ["id", "type", "result", "error", "event", "payload"];
  return protocolKeys.filter((key) => Object.hasOwn(value, key)).sort();
}
