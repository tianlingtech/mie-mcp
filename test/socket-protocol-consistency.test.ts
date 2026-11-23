import {
  SocketClientFrameSchema,
  SocketServerFrameSchema,
} from "@mie/tool-defs/socket-protocol";
import { describe, expect, it } from "vitest";

import {
  IncomingFrameSchema,
  ToolRequestFrameSchema,
} from "../src/protocol.js";

interface FrameSample {
  label: string;
  frame: unknown;
}

interface VerdictSample extends FrameSample {
  accepted: boolean;
}

const HELLO = {
  type: "hello",
  protocol_version: 1,
  bridge_version: "1.2.3",
  tool_defs_version: "0.2.0",
};

const REQUEST = {
  id: "request-1",
  type: "tool_request",
  tool: "tabs_context",
  args: {},
  timeout_ms: 30_000,
};

const PROFILE = {
  id: "6f7a32f6-685c-4f30-a647-c7c18bf758f2",
  name: "profile1",
  instanceId: "b7d7808b-f0cd-489a-aeb3-db914b42a133",
};

const SUCCESS = {
  id: "request-1",
  type: "tool_response",
  payload: { ok: true },
};

const ERROR = {
  id: "request-1",
  type: "tool_response",
  error: { code: "TOOL_ERROR", message: "Tool failed." },
};

// Inbound invariant: remote acceptance requires local acceptance.
const INBOUND_ALIGNED: VerdictSample[] = [
  {
    label: "hello with profile identity",
    frame: { ...HELLO, profile: PROFILE }, accepted: true,
  },
  {
    label: "hello with invalid profile identity",
    frame: { ...HELLO, profile: { ...PROFILE, instanceId: "invalid" } },
    accepted: false,
  },
  {
    label: "hello with unknown field",
    frame: { ...HELLO, future: true },
    accepted: true,
  },
  {
    label: "success response with unknown field",
    frame: { ...SUCCESS, duration_ms: 5 },
    accepted: true,
  },
  {
    label: "error response with unknown fields",
    frame: {
      ...ERROR,
      retriable: true,
      error: { ...ERROR.error, data: { future: true } },
    },
    accepted: true,
  },
  {
    label: "event with unknown field",
    frame: { type: "event", future: true },
    accepted: true,
  },
  { label: "empty error", frame: { ...ERROR, error: {} }, accepted: false },
  { label: "string error", frame: { ...ERROR, error: "boom" }, accepted: false },
  { label: "null error", frame: { ...ERROR, error: null }, accepted: false },
  { label: "boolean error", frame: { ...ERROR, error: true }, accepted: false },
  { label: "array error", frame: { ...ERROR, error: [] }, accepted: false },
  {
    label: "numeric error code",
    frame: { ...ERROR, error: { code: 1, message: "Tool failed." } },
    accepted: false,
  },
  {
    label: "empty error code",
    frame: { ...ERROR, error: { code: "", message: "Tool failed." } },
    accepted: false,
  },
  {
    label: "both response keys",
    frame: { ...SUCCESS, error: ERROR.error },
    accepted: false,
  },
  {
    label: "neither response key",
    frame: { id: "request-1", type: "tool_response" },
    accepted: false,
  },
  {
    label: "missing response id",
    frame: { type: "tool_response", payload: {} },
    accepted: false,
  },
  { label: "empty response id", frame: { ...SUCCESS, id: "" }, accepted: false },
];

// Inbound receiver tolerance may exceed the remote declaration.
const INBOUND_EXPECTED_DIFFERENCES: FrameSample[] = [
  { label: "hello protocol literal", frame: { ...HELLO, protocol_version: 2 } },
  { label: "hello bridge semver", frame: { ...HELLO, bridge_version: "dev" } },
  { label: "hello tool defs semver", frame: { ...HELLO, tool_defs_version: "dev" } },
  // Remote payloads are named-field objects for additive evolution.
  { label: "null response payload", frame: { ...SUCCESS, payload: null } },
  { label: "numeric response payload", frame: { ...SUCCESS, payload: 0 } },
  { label: "boolean response payload", frame: { ...SUCCESS, payload: false } },
  // Remote messages carry agent actions; the local fallback is defensive only.
  {
    label: "missing error message",
    frame: { ...ERROR, error: { code: "SENT_LINK_LOST" } },
  },
  {
    label: "empty error message",
    frame: { ...ERROR, error: { code: "SENT_LINK_LOST", message: "" } },
  },
];

// Outbound invariant: local acceptance requires remote acceptance.
const OUTBOUND_ALIGNED: VerdictSample[] = [
  {
    label: "request with expected profile",
    frame: { ...REQUEST, expectedProfile: PROFILE }, accepted: true,
  },
  {
    label: "request with invalid expected profile",
    frame: { ...REQUEST, expectedProfile: { ...PROFILE, name: "../profile" } },
    accepted: false,
  },
  { label: "valid request", frame: REQUEST, accepted: true },
  { label: "empty request id", frame: { ...REQUEST, id: "" }, accepted: false },
  { label: "empty tool", frame: { ...REQUEST, tool: "" }, accepted: false },
  { label: "missing args", frame: withoutKey(REQUEST, "args"), accepted: false },
  { label: "zero timeout", frame: { ...REQUEST, timeout_ms: 0 }, accepted: false },
  {
    label: "fractional timeout",
    frame: { ...REQUEST, timeout_ms: 1.5 },
    accepted: false,
  },
];

// Outbound local strictness is safe and intentionally recorded.
const OUTBOUND_LOCAL_STRICTNESS: FrameSample[] = [
  { label: "missing timeout", frame: withoutKey(REQUEST, "timeout_ms") },
  { label: "unknown request field", frame: { ...REQUEST, future: true } },
];

// Outbound local tolerance is a registered defect, never an exception.
const OUTBOUND_KNOWN_ARGS_DEFECTS: FrameSample[] = [
  { label: "null request args", frame: { ...REQUEST, args: null } },
  { label: "numeric request args", frame: { ...REQUEST, args: 0 } },
  { label: "boolean request args", frame: { ...REQUEST, args: false } },
  { label: "array request args", frame: { ...REQUEST, args: [] } },
];

describe("socket protocol directional consistency", () => {
  it.each(INBOUND_ALIGNED)(
    "keeps inbound verdict aligned: $label",
    ({ frame, accepted }) => {
      expect(inboundVerdicts(frame)).toEqual([accepted, accepted]);
    },
  );

  it.each(INBOUND_EXPECTED_DIFFERENCES)(
    "documents inbound receiver tolerance: $label",
    ({ frame }) => {
      expect(inboundVerdicts(frame)).toEqual([true, false]);
    },
  );

  it.each(OUTBOUND_ALIGNED)(
    "keeps outbound verdict aligned: $label",
    ({ frame, accepted }) => {
      expect(outboundVerdicts(frame)).toEqual([accepted, accepted]);
    },
  );

  it.each(OUTBOUND_LOCAL_STRICTNESS)(
    "documents safe outbound local strictness: $label",
    ({ frame }) => {
      expect(outboundVerdicts(frame)).toEqual([false, true]);
    },
  );

  it.fails.each(OUTBOUND_KNOWN_ARGS_DEFECTS)(
    "tracks args guard defect; fixed means remove this registration: $label",
    ({ frame }) => {
      const [localAccepted, remoteAccepted] = outboundVerdicts(frame);
      if (localAccepted) {
        expect(remoteAccepted).toBe(true);
      }
    },
  );
});

function inboundVerdicts(frame: unknown): [boolean, boolean] {
  return [
    IncomingFrameSchema.safeParse(frame).success,
    SocketServerFrameSchema.safeParse(frame).success,
  ];
}

function outboundVerdicts(frame: unknown): [boolean, boolean] {
  return [
    ToolRequestFrameSchema.safeParse(frame).success,
    SocketClientFrameSchema.safeParse(frame).success,
  ];
}

function withoutKey<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const entries = Object.entries(value).filter(([name]) => name !== key);
  return Object.fromEntries(entries) as Omit<T, K>;
}
