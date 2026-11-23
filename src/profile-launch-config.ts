import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ProfileNameSchema } from "@mie/tool-defs/profiles";
import { z } from "zod";

import { BridgeError } from "./bridge-error.js";

const MAX_CONFIG_BYTES = 65_536;
const AbsolutePathSchema = z.string().min(1).max(4096)
  .refine((value) => isAbsolute(value) && !value.includes("\0"));
const LaunchTargetSchema = z.strictObject({
  profileId: z.uuid(),
  executable: AbsolutePathSchema,
  userDataDir: AbsolutePathSchema,
  profileDirectory: z.string().min(1).max(255)
    .refine((value) => !/[\\/\0]/.test(value) && ![".", ".."].includes(value)),
});
const LaunchConfigSchema = z.strictObject({
  version: z.literal(1),
  profiles: z.record(ProfileNameSchema, LaunchTargetSchema),
});
export type LaunchTarget = z.infer<typeof LaunchTargetSchema>;

export async function readLaunchTarget(
  configPath: string | undefined, name: string,
): Promise<LaunchTarget | undefined> {
  if (configPath === undefined) return undefined;
  try {
    AbsolutePathSchema.parse(configPath);
    const handle = await open(configPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 || stat.size > MAX_CONFIG_BYTES) {
        throw new Error("Invalid launch configuration file.");
      }
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_CONFIG_BYTES) throw new Error("Launch config is too large.");
      const config = LaunchConfigSchema.parse(
        JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
      );
      return Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    throw new BridgeError("PROFILE_LAUNCH_CONFIG_INVALID",
      "Launch configuration must be a valid, owned 0600 regular JSON file.");
  }
}

export async function validateLaunchPaths(target: LaunchTarget): Promise<void> {
  try {
    const executable = await lstat(target.executable);
    if (!executable.isFile() || (executable.mode & 0o111) === 0 ||
      (executable.mode & 0o022) !== 0) throw new Error("Unsafe executable.");
    for (const path of [target.userDataDir,
      join(target.userDataDir, target.profileDirectory)]) {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o022) !== 0) throw new Error("Unsafe profile directory.");
    }
  } catch {
    throw new BridgeError("PROFILE_LAUNCH_CONFIG_INVALID",
      "Launch paths must reference an existing executable and owned " +
      "profile directories, without symlinks or group/world write access.");
  }
}
