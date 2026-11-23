import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ScreenshotDiagnosticMetadataSchema, ScreenshotViewportSchema }
  from "@mie/tool-defs/schemas";

import { BridgeError } from "./bridge-error.js";
import { saveScreenshot } from "./screenshot-storage.js";
import { screenshotDimensions } from "./screenshot-dimensions.js";

const ScreenshotSchema = z.object({
  base64: z.string().min(1).max(48 * 1024 * 1024)
    .refine((value) => Buffer.from(value, "base64").toString("base64") === value),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  obscured: z.boolean().optional(),
  screenshotViewport: ScreenshotViewportSchema.optional(),
  diagnosticId: z.unknown().optional(),
  diagnosticStatus: z.unknown().optional(),
});

export const ScreenshotOptionsSchema = z.object({
  action: z.literal("screenshot"),
  savePath: z.string().min(1).max(4096).optional(),
  overwrite: z.boolean().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
});

export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;

export async function createScreenshotResult(
  payload: unknown,
  options: ScreenshotOptions,
): Promise<CallToolResult> {
  const parsed = ScreenshotSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BridgeError("TOOL_ERROR", "Invalid screenshot response.");
  }
  const { base64: data, mimeType, obscured, screenshotViewport } = parsed.data;
  const format = options.format ?? "png";
  if (mimeType !== `image/${format}`) {
    throw new BridgeError("TOOL_ERROR", "Screenshot MIME does not match format.");
  }
  const bytes = Buffer.from(data, "base64");
  const dimensions = screenshotDimensions(bytes, format);
  const savePath = options.savePath === undefined ? undefined
    : await saveScreenshot(bytes, options.savePath,
      options.overwrite === true, format);
  const metadata = {
    mimeType, ...dimensions,
    ...diagnosticMetadata(parsed.data),
    ...viewportMetadata(screenshotViewport, dimensions),
    ...(obscured === undefined ? {} : { obscured }),
    ...(savePath === undefined ? {} : { savePath }),
  };
  return {
    content: [
      { type: "image", data, mimeType },
      { type: "text", text: JSON.stringify(metadata) },
    ],
    structuredContent: metadata,
  };
}

function diagnosticMetadata(
  payload: { diagnosticId?: unknown; diagnosticStatus?: unknown },
) {
  const { diagnosticId, diagnosticStatus } = payload;
  if (diagnosticId === undefined && diagnosticStatus === undefined) return {};
  const parsed = ScreenshotDiagnosticMetadataSchema.safeParse({
    ...(diagnosticId === undefined ? {} : { diagnosticId }), diagnosticStatus,
  });
  return parsed.success ? parsed.data : { diagnosticStatus: "unavailable" };
}

function viewportMetadata(
  viewport: z.infer<typeof ScreenshotViewportSchema> | undefined,
  dimensions: { width: number; height: number },
) {
  return viewport === undefined ? {} : {
    screenshotViewport: viewport,
    coordinateMapping: {
      space: "viewport-css",
      origin: { x: viewport.x, y: viewport.y },
      cssPixelsPerImagePixel: {
        x: viewport.width / dimensions.width,
        y: viewport.height / dimensions.height,
      },
    },
  };
}
