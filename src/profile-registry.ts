import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProfileDiscoveryRecordSchema } from "@mie/tool-defs/profiles";
import type { z } from "zod";

import { BridgeError } from "./bridge-error.js";

export type ProfileRecord = z.infer<typeof ProfileDiscoveryRecordSchema>;
const MAX_RECORD_BYTES = 16_384;

export async function readProfileRecords(
  directory: string,
): Promise<ProfileRecord[]> {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0) {
      throw registryError();
    }
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const records = await Promise.all(names.map((name) =>
      readRecord(join(directory, name), name)));
    return records.filter((record) => record !== undefined);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    if (error instanceof BridgeError) throw error;
    throw registryError();
  }
}

async function readRecord(
  filePath: string,
  filename: string,
): Promise<ProfileRecord | undefined> {
  const handle = await open(filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch((error: unknown) => {
      if (hasCode(error, "ENOENT")) return undefined;
      throw registryError();
    });
  if (handle === undefined) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 || stat.size > MAX_RECORD_BYTES) {
      throw registryError();
    }
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_RECORD_BYTES) throw registryError();
    const record = ProfileDiscoveryRecordSchema.parse(
      JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
    );
    if (filename !== `${record.profile.id}.json`) throw registryError();
    return record;
  } catch {
    throw registryError();
  } finally {
    await handle.close();
  }
}

function registryError(): BridgeError {
  return new BridgeError("NOT_SENT", "Profile registry could not be validated.");
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
