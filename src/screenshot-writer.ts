import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync }
  from "node:fs";
import { basename, isAbsolute, parse, relative, sep } from "node:path";
import { z } from "zod";

import { BridgeError } from "./bridge-error.js";

const ArgumentsSchema = z.tuple([
  z.string().refine(isAbsolute),
  z.string().refine(isAbsolute),
  z.enum(["true", "false"]),
]);

function enterDirectory(directory: string): void {
  const root = parse(directory).root;
  process.chdir(root);
  for (const part of relative(root, directory).split(sep).filter(Boolean)) {
    try {
      mkdirSync(part, { mode: 0o700 });
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const before = lstatSync(part);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new BridgeError("INVALID_ARGUMENT",
        "Screenshot paths must not contain symlinks or non-directories.");
    }
    process.chdir(part);
    const after = statSync(".");
    if (before.dev !== after.dev || before.ino !== after.ino) {
      throw new BridgeError("INVALID_ARGUMENT",
        "Screenshot directory changed while resolving the path.");
    }
  }
}

function checkTarget(target: string, overwrite: boolean): void {
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new BridgeError("INVALID_ARGUMENT",
        "Screenshot target must be a regular file, not a symlink.");
    }
    if (!overwrite) {
      throw new BridgeError("INVALID_ARGUMENT",
        "Screenshot already exists. Set overwrite=true to replace it.");
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

function publish(bytes: Buffer, target: string, overwrite: boolean): void {
  const directory = statSync(".");
  if (directory.uid !== process.getuid?.() || (directory.mode & 0o022) !== 0) {
    throw new BridgeError("INVALID_ARGUMENT",
      "Screenshot directory must be owned by this user and not writable "
      + "by group or others.");
  }
  checkTarget(target, overwrite);
  const temporary = `.mie-${randomUUID()}.tmp`;
  const file = openSync(temporary, constants.O_WRONLY | constants.O_CREAT
    | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      if (!fstatSync(file).isFile()) {
        throw new BridgeError("TOOL_ERROR", "Invalid screenshot temporary file.");
      }
      writeFileSync(file, bytes);
    } finally {
      closeSync(file);
    }
    checkTarget(target, overwrite);
    if (overwrite) renameSync(temporary, target);
    else linkSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function main(): object {
  try {
    const [directory, target, overwrite] = ArgumentsSchema.parse(
      process.argv.slice(2),
    );
    const bytes = readFileSync(0);
    enterDirectory(directory);
    publish(bytes, basename(target), overwrite === "true");
    return { ok: true, savePath: target };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof BridgeError ? error.code : "TOOL_ERROR",
      message: error instanceof Error ? error.message : "Screenshot save failed.",
    };
  }
}

process.stdout.write(JSON.stringify(main()));
