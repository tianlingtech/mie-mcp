import { z } from "zod";
import { ProfileIdentitySchema } from "@mie/tool-defs/profiles";

export const SUPPORTED_PROTOCOL_VERSION = 1;

export const BRIDGE_ERROR_CODES = [
  "BRIDGE_NOT_RUNNING",
  "NOT_SENT",
  "SENT_LINK_LOST",
  "TIMEOUT",
  "TAB_GONE",
  "TOOL_ERROR",
] as const;

export type KnownBridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];
export type BridgeErrorCode = KnownBridgeErrorCode | (string & {});

export const HelloFrameSchema = z.looseObject({
  type: z.literal("hello"),
  protocol_version: z.number().int().nonnegative(),
  bridge_version: z.string(),
  tool_defs_version: z.string(),
  profile: ProfileIdentitySchema.optional(),
});

export const ToolRequestFrameSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal("tool_request"),
  tool: z.string().min(1),
  args: z.unknown(),
  timeout_ms: z.number().int().positive(),
  expectedProfile: ProfileIdentitySchema.optional(),
});

export const BridgeErrorPayloadSchema = z.looseObject({
  code: z.string().min(1),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const ToolSuccessResponseFrameSchema = z
  .looseObject({
    id: z.string().min(1),
    type: z.literal("tool_response"),
    payload: z.unknown(),
  })
  .refine(
    (frame) =>
      Object.hasOwn(frame, "payload") && !Object.hasOwn(frame, "error"),
    { message: "A successful tool response must contain only payload." },
  );

const ToolErrorResponseFrameSchema = z
  .looseObject({
    id: z.string().min(1),
    type: z.literal("tool_response"),
    error: BridgeErrorPayloadSchema,
  })
  .refine(
    (frame) =>
      Object.hasOwn(frame, "error") && !Object.hasOwn(frame, "payload"),
    { message: "An error tool response must contain only error." },
  );

export const ToolResponseFrameSchema = z.union([
  ToolErrorResponseFrameSchema,
  ToolSuccessResponseFrameSchema,
]);

export const EventFrameSchema = z.looseObject({
  type: z.literal("event"),
});

export const IncomingFrameSchema = z.union([
  HelloFrameSchema,
  ToolResponseFrameSchema,
  EventFrameSchema,
]);

export type HelloFrame = z.infer<typeof HelloFrameSchema>;
export type ProfileIdentity = z.infer<typeof ProfileIdentitySchema>;
export type ToolRequestFrame = z.infer<typeof ToolRequestFrameSchema>;
export type ToolResponseFrame = z.infer<typeof ToolResponseFrameSchema>;
export type EventFrame = z.infer<typeof EventFrameSchema>;
export type BridgeErrorPayload = z.infer<typeof BridgeErrorPayloadSchema>;
