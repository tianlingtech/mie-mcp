import { BridgeError } from "./bridge-error.js";
import type { ScreenshotFormat } from "./screenshot-storage.js";

interface Dimensions { width: number; height: number }

export function screenshotDimensions(
  bytes: Buffer, format: ScreenshotFormat,
): Dimensions {
  const dimensions = format === "png" ? pngDimensions(bytes)
    : jpegDimensions(bytes);
  if (dimensions.width === 0 || dimensions.height === 0
    || dimensions.width > 0x7fffffff || dimensions.height > 0x7fffffff) {
    throw new BridgeError("TOOL_ERROR", "Invalid screenshot dimensions.");
  }
  return dimensions;
}

function pngDimensions(bytes: Buffer): Dimensions {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const end = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(8) !== 13
    || bytes.toString("ascii", 12, 16) !== "IHDR"
    || !bytes.subarray(-12).equals(end)) {
    throw new BridgeError("TOOL_ERROR", "Invalid screenshot PNG header.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): Dimensions {
  const invalid = () => new BridgeError(
    "TOOL_ERROR", "Invalid screenshot JPEG header.",
  );
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8
    || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw invalid();
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd8
      || marker === 0xd9 || marker === 0xda
      || (marker >= 0xd0 && marker <= 0xd7)) throw invalid();
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length - 2) throw invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) throw invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8) throw invalid();
      const components = bytes[offset + 7] ?? 0;
      if (components === 0 || length !== 8 + 3 * components) throw invalid();
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw invalid();
}
