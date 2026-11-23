import { z } from "zod";
import { ProfileNameSchema, ProfilesLaunchInputSchema, sameProfile }
  from "@mie/tool-defs/profiles";

import {
  BridgeClient,
  type BridgeClientOptions, type BridgeRequest,
} from "./bridge-client.js";
import { BridgeError } from "./bridge-error.js";
import { readProfileRecords, type ProfileRecord } from "./profile-registry.js";
import type { ProfileIdentity } from "./protocol.js";
import { resolveBridgeSocketPath } from "./socket-path.js";
import { PACKAGE_VERSION } from "./package-info.js";
import { ProfileLauncher } from "./profile-launcher.js";

const RoutingArgsSchema = z.looseObject({ profile: ProfileNameSchema.optional() });

interface ConnectionEntry {
  client: BridgeClient;
  users: number;
  retired: boolean;
}

interface Candidate {
  socketPath: string;
  expected?: ProfileIdentity;
  entry: ConnectionEntry;
}

interface OnlineProfile {
  candidate: Candidate;
  identity?: ProfileIdentity;
}

export interface ProfileRouterOptions {
  registryDirectory: string;
  socketPath?: string;
  launchConfigPath?: string;
  clientOptions?: Omit<BridgeClientOptions, "socketPath">;
}

export class ProfileRouter {
  private readonly clients = new Map<string, ConnectionEntry>();
  private readonly connections = new Set<ConnectionEntry>();
  private closed = false;
  private readonly launcher: ProfileLauncher;

  constructor(private readonly options: ProfileRouterOptions) {
    this.launcher = new ProfileLauncher(options.launchConfigPath,
      (name, signal) => this.probeForLaunch(name, signal));
  }

  async request(input: BridgeRequest): Promise<unknown> {
    if (this.closed) throw new BridgeError("NOT_SENT", "Profile router is closed.");
    if (input.tool === "profiles_launch") {
      const launch = ProfilesLaunchInputSchema.safeParse(input.args);
      if (!launch.success) {
        throw new BridgeError("INVALID_ARGUMENT", "Invalid profile launch arguments.");
      }
      return this.launcher.launch(launch.data.profile, launch.data.timeoutMs ?? 10_000);
    }
    const parsed = RoutingArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      throw new BridgeError("INVALID_ARGUMENT", "Invalid profile arguments.");
    }
    const name = parsed.data.profile ?? "default";
    const records = await readProfileRecords(this.options.registryDirectory);
    if (this.closed) throw new BridgeError("NOT_SENT", "Profile router is closed.");
    this.retireUnused(records);
    const listing = input.tool === "profiles_list";
    const candidates = this.candidates(records, listing ? undefined : name);
    try {
      const online = await this.probeAll(candidates, !listing);
      this.checkConflicts(online);
      if (listing) return this.listResult(online);
      const selected = online[0];
      if (selected === undefined) throw this.unavailable(name, candidates);
      const expectedProfile = selected.identity;
      const { profile: _profile, ...legacyArgs } = parsed.data;
      return await selected.candidate.entry.client.request({
        ...input,
        args: expectedProfile === undefined ? legacyArgs : input.args,
        profileName: name,
        ...(expectedProfile === undefined ? {} : { expectedProfile }),
      });
    } finally {
      for (const candidate of candidates) this.release(candidate.entry);
    }
  }

  close(): void {
    this.closed = true;
    this.launcher.close();
    for (const entry of this.connections) entry.client.close();
    this.connections.clear();
    this.clients.clear();
  }

  private async probeForLaunch(
    name: string, signal: AbortSignal,
  ): Promise<ProfileIdentity | undefined> {
    const records = await readProfileRecords(this.options.registryDirectory);
    signal.throwIfAborted();
    const candidates = this.candidates(records, name, true);
    const abort = () => {
      for (const candidate of candidates) candidate.entry.client.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const online = await this.probeAll(candidates, false);
      signal.throwIfAborted();
      this.checkConflicts(online);
      if (online.length > 0 && online[0]?.identity === undefined) {
        throw new BridgeError("PROFILE_IDENTITY_MISMATCH",
          "Legacy bridge has no identity; profile launch cannot verify it.");
      }
      return online[0]?.identity;
    } finally {
      signal.removeEventListener("abort", abort);
      for (const candidate of candidates) this.release(candidate.entry);
    }
  }

  private candidates(
    records: ProfileRecord[], name?: string, transient = false,
  ): Candidate[] {
    const selected = records.filter((record) =>
      name === undefined || record.profile.name === name);
    const candidates: Array<{
      socketPath: string; expected: ProfileIdentity | undefined;
    }> = selected.map((record) => ({
      socketPath: this.recordSocket(record), expected: record.profile,
    }));
    if ((name === undefined || name === "default") &&
      !records.some((record) => record.profile.name === "default")) {
      candidates.push({ socketPath: this.defaultSocket(), expected: undefined });
    }
    return candidates.map(({ socketPath, expected }) => ({
      socketPath,
      ...(expected === undefined ? {} : { expected }),
      entry: this.acquire(socketPath, expected, transient),
    }));
  }

  private async probeAll(
    candidates: Candidate[], legacyFailureFatal: boolean,
  ): Promise<OnlineProfile[]> {
    const results = await Promise.allSettled(candidates.map(async (candidate) => {
      const info = await candidate.entry.client.connect();
      const identity = info.profile;
      const mismatch = candidate.expected === undefined
        ? identity !== undefined && identity.name !== "default"
        : identity === undefined || !sameProfile(candidate.expected, identity);
      if (mismatch) {
        throw new BridgeError(
          "PROFILE_IDENTITY_MISMATCH", "Bridge profile does not match discovery.",
        );
      }
      return { candidate, ...(identity === undefined ? {} : { identity }) };
    }));
    const online: OnlineProfile[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") online.push(result.value);
      else if ((legacyFailureFatal && candidates.length === 1 &&
        candidates[0]?.expected === undefined) ||
        !(result.reason instanceof BridgeError) ||
        !["BRIDGE_NOT_RUNNING", "NOT_SENT"].includes(result.reason.code)) {
        throw result.reason;
      }
    }
    return online;
  }

  private checkConflicts(online: OnlineProfile[]): void {
    const names = online.map(({ identity }) => identity?.name ?? "default");
    if (new Set(names).size !== names.length) {
      throw new BridgeError("PROFILE_CONFLICT", "Multiple online profiles share a name.");
    }
  }

  private listResult(online: OnlineProfile[]): unknown {
    return { serverVersion: PACKAGE_VERSION,
      profiles: online.flatMap(({ identity }) =>
      identity === undefined ? [] : [{ ...identity, status: "online" as const }])
      .sort((left, right) => left.name.localeCompare(right.name)) };
  }

  private unavailable(name: string, candidates: Candidate[]): BridgeError {
    if (candidates.length === 0) {
      return new BridgeError("PROFILE_NOT_FOUND", "Requested profile was not found.");
    }
    if (name === "default" && candidates.every((entry) => !entry.expected)) {
      return new BridgeError("BRIDGE_NOT_RUNNING", "Default bridge is not running.");
    }
    return new BridgeError("PROFILE_OFFLINE", "Requested profile is offline.");
  }

  private acquire(
    socketPath: string, profile?: ProfileIdentity, transient = false,
  ): ConnectionEntry {
    const key = this.key(socketPath, profile);
    const existing = transient ? undefined : this.clients.get(key);
    if (existing !== undefined) {
      existing.users += 1;
      return existing;
    }
    const entry = {
      client: new BridgeClient({ ...this.options.clientOptions, socketPath }),
      users: 1, retired: transient,
    };
    if (!transient) this.clients.set(key, entry);
    this.connections.add(entry);
    return entry;
  }

  private release(entry: ConnectionEntry): void {
    entry.users -= 1;
    if (entry.retired && entry.users === 0) this.closeEntry(entry);
  }

  private retireUnused(records: ProfileRecord[]): void {
    const keys = new Set(records.map((record) =>
      this.key(this.recordSocket(record), record.profile)));
    if (!records.some((record) => record.profile.name === "default")) {
      keys.add(this.key(this.defaultSocket()));
    }
    for (const [key, entry] of this.clients) {
      if (keys.has(key)) continue;
      entry.retired = true;
      this.clients.delete(key);
      if (entry.users === 0) this.closeEntry(entry);
    }
  }

  private recordSocket(record: ProfileRecord): string {
    return record.profile.name === "default"
      ? this.options.socketPath ?? record.socketPath : record.socketPath;
  }

  private closeEntry(entry: ConnectionEntry): void {
    entry.client.close();
    this.connections.delete(entry);
  }

  private defaultSocket(): string {
    return this.options.socketPath ?? resolveBridgeSocketPath();
  }

  private key(socketPath: string, profile?: ProfileIdentity): string {
    return JSON.stringify([socketPath, profile ?? null]);
  }
}
