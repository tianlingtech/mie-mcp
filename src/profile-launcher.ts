import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { BridgeError } from "./bridge-error.js";
import { readLaunchTarget, validateLaunchPaths, type LaunchTarget }
  from "./profile-launch-config.js";
import type { ProfileIdentity } from "./protocol.js";

const POLL_INTERVAL_MS = 250;
type OnlineProbe = (name: string, signal: AbortSignal) =>
  Promise<ProfileIdentity | undefined>;
interface LaunchResult {
  profile: ProfileIdentity;
  status: "online";
  launched: boolean;
}

export class ProfileLauncher {
  private readonly pending = new Map<string, Promise<LaunchResult>>();
  private readonly shutdown = new AbortController();

  constructor(
    private readonly configPath: string | undefined,
    private readonly probe: OnlineProbe,
  ) {}

  async launch(name: string, timeoutMs: number): Promise<LaunchResult> {
    this.shutdown.signal.throwIfAborted();
    const existing = this.pending.get(name);
    if (existing !== undefined) return this.bounded(timeoutMs, () => existing);
    const pending = this.bounded(timeoutMs, (signal) => this.run(name, signal));
    this.pending.set(name, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(name);
    }
  }

  close(): void {
    this.shutdown.abort(new BridgeError("NOT_SENT", "Profile router is closed."));
  }

  private async bounded(
    timeoutMs: number, operation: (signal: AbortSignal) => Promise<LaunchResult>,
  ): Promise<LaunchResult> {
    const deadline = new AbortController();
    const signal = AbortSignal.any([deadline.signal, this.shutdown.signal]);
    const timer = setTimeout(() => deadline.abort(new BridgeError(
      "PROFILE_LAUNCH_TIMEOUT", "Profile identity was not confirmed before " +
      "the deadline. Chrome may still be starting; it was not terminated.",
    )), timeoutMs);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      return await Promise.race([operation(signal), aborted]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async run(name: string, signal: AbortSignal): Promise<LaunchResult> {
    const target = await readLaunchTarget(this.configPath, name);
    signal.throwIfAborted();
    const online = await this.probe(name, signal);
    if (online !== undefined) return verified(online, target, false);
    if (target === undefined) throw new BridgeError("PROFILE_LAUNCH_NOT_CONFIGURED",
      "No explicit local launch mapping exists for this profile.");
    await validateLaunchPaths(target);
    signal.throwIfAborted();
    const child = startChrome(target);
    const completed = new AbortController();
    const waiting = AbortSignal.any([signal, completed.signal]);
    try {
      return await Promise.race([
        child.started.then(() => this.waitForProfile(name, target, waiting)),
        child.failed,
      ]);
    } finally {
      completed.abort();
      child.dispose();
    }
  }

  private async waitForProfile(
    name: string, target: LaunchTarget, signal: AbortSignal,
  ): Promise<LaunchResult> {
    while (true) {
      signal.throwIfAborted();
      const online = await this.probe(name, signal);
      signal.throwIfAborted();
      if (online !== undefined) return verified(online, target, true);
      await delay(POLL_INTERVAL_MS, undefined, { signal });
    }
  }
}

function verified(
  profile: ProfileIdentity, target: LaunchTarget | undefined, launched: boolean,
): LaunchResult {
  if (target !== undefined && profile.id !== target.profileId) {
    throw new BridgeError("PROFILE_IDENTITY_MISMATCH",
      "Online profile UUID does not match the configured launch identity.");
  }
  return { profile, status: "online", launched };
}

function startChrome(target: LaunchTarget) {
  const child = spawn(target.executable, [
    `--user-data-dir=${target.userDataDir}`,
    `--profile-directory=${target.profileDirectory}`, "--no-startup-window",
  ], { shell: false, detached: true, stdio: "ignore" });
  let rejectFailure: (error: BridgeError) => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  const onError = (error: Error) => rejectFailure(new BridgeError(
    "PROFILE_LAUNCH_FAILED", "Chrome process could not be started.",
    { reason: "code" in error ? String(error.code) : error.name },
  ));
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (code !== 0) rejectFailure(new BridgeError("PROFILE_LAUNCH_FAILED",
      `Chrome launch process exited with code ${code}, signal ${signal}.`));
  };
  child.on("error", onError);
  child.on("exit", onExit);
  const started = new Promise<void>((resolve) => {
    child.once("spawn", resolve);
  });
  child.unref();
  return { started, failed, dispose: () => {
    child.removeListener("exit", onExit);
  } };
}
