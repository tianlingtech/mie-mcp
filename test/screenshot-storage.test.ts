import { chmod, link, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile }
  from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createScreenshotResult }: typeof import("../src/screenshot-result.js") =
  await import(new URL("../dist/screenshot-result.js", import.meta.url).href);
const { saveScreenshot }: typeof import("../src/screenshot-storage.js") =
  await import(new URL("../dist/screenshot-storage.js", import.meta.url).href);
import { JPEG_BASE64, JPEG_SCREENSHOT_PAYLOAD, PNG_BASE64, SCREENSHOT_PAYLOAD }
  from "./support/screenshot-fixture.js";

let directory: string;
let root: string;
const bytes = Buffer.from(PNG_BASE64, "base64");

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "mie-screenshot-")));
  root = join(directory, "screenshots");
  vi.stubEnv("MIE_SCREENSHOT_DIR", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("screenshot storage", () => {
  it.each(["page.jpg", "page.jpeg", "page.JPEG"])(
    "saves JPEG %s with native content and actual pixel dimensions", async (name) => {
      const result = await createScreenshotResult({
        ...JPEG_SCREENSHOT_PAYLOAD, width: 99, height: 99,
      }, { action: "screenshot", format: "jpeg", savePath: name });
      expect(result.structuredContent).toEqual({
        mimeType: "image/jpeg", width: 1, height: 1, savePath: join(root, name),
      });
      expect(result.content[0]).toEqual({
        type: "image", data: JPEG_BASE64, mimeType: "image/jpeg",
      });
      expect(await readFile(join(root, name)))
        .toEqual(Buffer.from(JPEG_BASE64, "base64"));
    },
  );

  it.each([
    [SCREENSHOT_PAYLOAD, "jpeg", "page.jpg"],
    [JPEG_SCREENSHOT_PAYLOAD, "png", "page.png"],
    [{ ...JPEG_SCREENSHOT_PAYLOAD, base64: PNG_BASE64 }, "jpeg", "page.jpg"],
    [{ ...SCREENSHOT_PAYLOAD, base64: JPEG_BASE64 }, "png", "page.png"],
    [{ ...JPEG_SCREENSHOT_PAYLOAD, base64: "/9j/2Q==" }, "jpeg", "page.jpg"],
  ] as const)("rejects format/payload mismatch %#", async (payload, format, name) => {
    await expect(createScreenshotResult(payload, {
      action: "screenshot", format, savePath: name,
    })).rejects.toMatchObject({ code: "TOOL_ERROR" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects a JPEG save path with a PNG extension", async () => {
    await expect(createScreenshotResult(JPEG_SCREENSHOT_PAYLOAD, {
      action: "screenshot", format: "jpeg", savePath: "page.png",
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("saves nested PNGs and returns image content without base64 metadata", async () => {
    const diagnosticId = "11111111-1111-4111-8111-111111111111";
    const result = await createScreenshotResult(SCREENSHOT_PAYLOAD, {
      action: "screenshot", savePath: "nested/page.png",
    });
    const savePath = join(root, "nested", "page.png");
    expect(await readFile(savePath)).toEqual(bytes);
    expect(result.structuredContent).toEqual({
      mimeType: "image/png", width: 1, height: 1, savePath,
    });
    expect(result.content[0]).toEqual({
      type: "image", data: PNG_BASE64, mimeType: "image/png",
    });
    expect(result.content[1]).not.toHaveProperty("data");
    expect(await readdir(join(root, "nested"))).toEqual(["page.png"]);
    const diagnosed = await createScreenshotResult({ ...SCREENSHOT_PAYLOAD,
      diagnosticId, diagnosticStatus: "saved" },
    { action: "screenshot", savePath: "nested/diagnosed.png" });
    expect(diagnosed.structuredContent).toEqual({ mimeType: "image/png",
      width: 1, height: 1, savePath: join(root, "nested/diagnosed.png"),
      diagnosticId, diagnosticStatus: "saved" });
    expect(await readFile(join(root, "nested/diagnosed.png"))).toEqual(bytes);
  });

  it("does not write files when savePath is absent", async () => {
    const result = await createScreenshotResult(SCREENSHOT_PAYLOAD, {
      action: "screenshot",
    });
    expect(result.structuredContent).not.toHaveProperty("savePath");
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite viewport values before saving %s", async (value) => {
      await expect(createScreenshotResult({ ...SCREENSHOT_PAYLOAD,
        screenshotViewport: { x: value, y: 0, width: 1, height: 1 },
      }, { action: "screenshot", savePath: "page.png" }))
        .rejects.toMatchObject({ code: "TOOL_ERROR" });
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it("preserves viewport bounds and mapping when saving", async () => {
    const screenshotViewport = { x: 0, y: 1_000_000,
      width: 1_000_000, height: 0.5 };
    const result = await createScreenshotResult({ ...SCREENSHOT_PAYLOAD,
      screenshotViewport,
    }, { action: "screenshot", savePath: "page.png" });
    expect(result.structuredContent).toEqual({ mimeType: "image/png",
      width: 1, height: 1, savePath: join(root, "page.png"), screenshotViewport,
      coordinateMapping: { space: "viewport-css", origin: { x: 0, y: 1_000_000 },
        cssPixelsPerImagePixel: { x: 1_000_000, y: 0.5 } },
    });
    expect(await readFile(join(root, "page.png"))).toEqual(bytes);
  });

  it("reports the configured root without changing the error code", async () => {
    await expect(saveScreenshot(bytes, "/outside.png", false))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT",
        message: expect.stringContaining(`Allowed root: ${JSON.stringify(root)}`),
      });
    await expect(saveScreenshot(bytes, "../escape.png", false))
      .rejects.toThrow("Set MIE_SCREENSHOT_DIR to an absolute directory");
    expect(await readdir(directory)).toEqual([]);
  });

  it("reports the default root when no custom root is configured", async () => {
    vi.stubEnv("MIE_SCREENSHOT_DIR", undefined);
    const defaultRoot = join(process.cwd(), ".e2e-test", "screenshots");
    await expect(saveScreenshot(bytes, "/outside.png", false))
      .rejects.toThrow(`Allowed root: ${JSON.stringify(defaultRoot)}`);
  });

  it("rejects invalid root configuration without claiming a fallback", async () => {
    vi.stubEnv("MIE_SCREENSHOT_DIR", "relative-root");
    await expect(saveScreenshot(bytes, "page.png", false))
      .rejects.toMatchObject({ code: "TOOL_ERROR",
        message: "MIE_SCREENSHOT_DIR must be an absolute directory path.",
      });
    expect(await readdir(directory)).toEqual([]);
  });

  it("requires explicit overwrite and replaces instead of mutating hardlinks", async () => {
    const target = await saveScreenshot(bytes, "page.png", false);
    await writeFile(target, "original");
    const hardlink = join(directory, "hardlink.png");
    await link(target, hardlink);
    await expect(saveScreenshot(bytes, target, false)).rejects.toThrow(
      "Screenshot already exists",
    );
    expect(await readFile(target, "utf8")).toBe("original");
    await saveScreenshot(bytes, target, true);
    expect(await readFile(hardlink, "utf8")).toBe("original");
    expect(await readFile(target)).toEqual(bytes);
    expect(await readdir(root)).toEqual(["page.png"]);
  });

  it("allows exactly one concurrent writer when overwrite is false", async () => {
    const results = await Promise.allSettled([
      saveScreenshot(bytes, "page.png", false),
      saveScreenshot(bytes, "page.png", false),
    ]);
    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(await readFile(join(root, "page.png"))).toEqual(bytes);
    expect(await readdir(root)).toEqual(["page.png"]);
  });

  it("rejects existing directories writable by other users", async () => {
    await saveScreenshot(bytes, "page.png", false);
    await chmod(root, 0o777);
    await expect(saveScreenshot(bytes, "new.png", false)).rejects.toThrow(
      "not writable by group or others",
    );
    expect(await readdir(root)).toEqual(["page.png"]);
  });

  it.each(["../escape.png", "nested/../../escape.png", "/outside.png",
    "page.jpg", "page\0.png", "..\\escape.png"])(
    "rejects invalid target %j", async (target) => {
      await expect(saveScreenshot(bytes, target, false)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it("rejects symlink roots, parents and files even with overwrite", async () => {
    await symlink(directory, root);
    await expect(saveScreenshot(bytes, "page.png", true)).rejects.toThrow(
      "symlinks",
    );
    await rm(root);
    await saveScreenshot(bytes, "existing.png", false);
    await symlink(directory, join(root, "alias"));
    await expect(saveScreenshot(bytes, "alias/page.png", true)).rejects.toThrow(
      "symlinks",
    );
    const outside = join(directory, "outside.png");
    await writeFile(outside, "unchanged");
    await symlink(outside, join(root, "file.png"));
    await expect(saveScreenshot(bytes, "file.png", true)).rejects.toThrow(
      "symlink",
    );
    expect(await readFile(outside, "utf8")).toBe("unchanged");
  });

  it.each([
    { ...SCREENSHOT_PAYLOAD, base64: "cG5n" },
    { ...SCREENSHOT_PAYLOAD, base64: PNG_BASE64 + "!" },
    { ...SCREENSHOT_PAYLOAD, mimeType: "text/plain" },
    { ...SCREENSHOT_PAYLOAD, base64: null },
  ])("rejects malformed screenshot responses without writing", async (payload) => {
    await expect(createScreenshotResult(payload, {
      action: "screenshot", savePath: "page.png",
    })).rejects.toMatchObject({ code: "TOOL_ERROR" });
    expect(await readdir(directory)).toEqual([]);
  });
});
