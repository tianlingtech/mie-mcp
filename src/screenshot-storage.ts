import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { BridgeError } from "./bridge-error.js";

export const SCREENSHOT_DIRECTORY_ENV = "MIE_SCREENSHOT_DIR";

function outputDirectory(): string {
  const configured = process.env[SCREENSHOT_DIRECTORY_ENV];
  if (configured !== undefined
    && (!isAbsolute(configured) || configured.includes("\0"))) {
    throw new BridgeError("TOOL_ERROR",
      "MIE_SCREENSHOT_DIR must be an absolute directory path.");
  }
  return resolve(configured ?? join(process.cwd(), ".e2e-test", "screenshots"));
}

export type ScreenshotFormat = "png" | "jpeg";

export function validateScreenshotPath(
  savePath: string, format: ScreenshotFormat = "png",
): string {
  const root = outputDirectory();
  const target = resolve(root, savePath);
  const within = relative(root, target);
  if (savePath.includes("\0") || savePath.split(/[\\/]/).includes("..")
    || within === "" || within === ".." || within.startsWith(`..${sep}`)
    || isAbsolute(within) || !(format === "png" ? /\.png$/i : /\.jpe?g$/i)
      .test(target)) {
    throw new BridgeError("INVALID_ARGUMENT",
      "savePath must be inside the screenshot output directory and its "
      + "extension must match the requested image format. "
      + `Allowed root: ${JSON.stringify(root)}. `
      + "Set MIE_SCREENSHOT_DIR to an absolute directory when starting "
      + "the MCP server to configure the output root.");
  }
  return target;
}

const WriterResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), savePath: z.string().min(1) }),
  z.strictObject({ ok: z.literal(false), code: z.enum([
    "INVALID_ARGUMENT", "TOOL_ERROR",
  ]), message: z.string() }),
]);

export async function saveScreenshot(
  bytes: Buffer,
  savePath: string,
  overwrite: boolean,
  format: ScreenshotFormat = "png",
): Promise<string> {
  const target = validateScreenshotPath(savePath, format);
  const response = await runWriter(bytes, target, overwrite);
  const parsed = WriterResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new BridgeError("TOOL_ERROR", "Invalid screenshot writer response.");
  }
  if (!parsed.data.ok) {
    throw new BridgeError(parsed.data.code, parsed.data.message);
  }
  return parsed.data.savePath;
}

function runWriter(
  bytes: Buffer, target: string, overwrite: boolean,
): Promise<unknown> {
  const writerPath = fileURLToPath(new URL("./screenshot-writer.js", import.meta.url));
  return new Promise((resolveResult, reject) => {
    let inputError: Error | undefined;
    const child = execFile(process.execPath,
      [writerPath, dirname(target), target, String(overwrite)],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 16_384 },
      (error, stdout) => {
        if (error !== null || inputError !== undefined) {
          reject(new BridgeError("TOOL_ERROR", "Screenshot writer failed.", {
            reason: (error ?? inputError)?.message,
          }));
          return;
        }
        try {
          resolveResult(JSON.parse(stdout) as unknown);
        } catch {
          reject(new BridgeError("TOOL_ERROR", "Invalid screenshot writer output."));
        }
      });
    child.stdin?.on("error", (error: Error) => { inputError = error; });
    child.stdin?.end(bytes);
  });
}
