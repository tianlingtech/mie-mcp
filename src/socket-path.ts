import { tmpdir } from "node:os";
import { join } from "node:path";

function getCurrentUid(): number {
  if (typeof process.getuid !== "function") {
    throw new Error("The current platform does not expose a Unix user id.");
  }

  return process.getuid();
}

export function resolveBridgeSocketPath(
  tempDirectory = tmpdir(),
  uid = getCurrentUid(),
): string {
  if (tempDirectory.length === 0) {
    throw new TypeError("The temporary directory must not be empty.");
  }

  if (!Number.isInteger(uid) || uid < 0) {
    throw new TypeError("The Unix user id must be a non-negative integer.");
  }

  return join(tempDirectory, "mie-bridge", String(uid), "bridge.sock");
}
