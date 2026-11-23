#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getProfileRegistryDirectory } from "@mie/tool-defs/profile-paths";
import { ProfileRouter } from "./profile-router.js";
import { createMcpServer } from "./mcp-server.js";
import {
  EXPECTED_PROTOCOL_VERSION,
  EXPECTED_TOOL_DEFS_VERSION,
  P0_TOOL_DEFINITIONS,
} from "./tool-defs.js";

export const VERBOSE_DIAGNOSTICS_ENV = "MIE_VERBOSE_DIAGNOSTICS";
export const BRIDGE_SOCKET_ENV = "MIE_BRIDGE_SOCKET";
export const PROFILE_LAUNCH_CONFIG_ENV = "MIE_PROFILE_LAUNCH_CONFIG";

export async function main(): Promise<void> {
  const socketPath = parseBridgeSocketPath(process.env[BRIDGE_SOCKET_ENV]);
  const launchConfigPath = process.env[PROFILE_LAUNCH_CONFIG_ENV];
  const bridgeClient = new ProfileRouter({
    registryDirectory: getProfileRegistryDirectory(),
    ...(socketPath === undefined ? {} : { socketPath }),
    ...(launchConfigPath === undefined ? {} : { launchConfigPath }),
    clientOptions: {
      supportedProtocolVersion: EXPECTED_PROTOCOL_VERSION,
      expectedToolDefsVersion: EXPECTED_TOOL_DEFS_VERSION,
      verboseDiagnostics: parseVerboseDiagnostics(
        process.env[VERBOSE_DIAGNOSTICS_ENV],
      ),
    },
  });
  const server = createMcpServer({
    bridgeClient,
    toolDefinitions: P0_TOOL_DEFINITIONS,
  });
  const transport = new StdioServerTransport();
  const cleanup = installShutdownHandlers(bridgeClient, server, transport);

  try {
    await server.connect(transport);
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function parseVerboseDiagnostics(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function parseBridgeSocketPath(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

interface ClosableServer {
  close(): Promise<void>;
}

function installShutdownHandlers(
  bridgeClient: { close(): void },
  server: ClosableServer,
  transport: StdioServerTransport,
): () => void {
  let closed = false;

  const cleanup = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    process.stdin.off("end", handleStdinEnd);
    bridgeClient.close();
  };
  const closeServer = async (): Promise<void> => {
    cleanup();
    await server.close();
  };
  const handleSignal = (): void => {
    void closeServer().catch((error: unknown) => {
      console.error("Failed to stop mie MCP server.", error);
      process.exitCode = 1;
    });
  };
  const handleStdinEnd = (): void => {
    void transport.close().catch((error: unknown) => {
      console.error("Failed to close stdio transport.", error);
      process.exitCode = 1;
    });
  };

  transport.onclose = cleanup;
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  process.stdin.once("end", handleStdinEnd);
  return cleanup;
}

export function isDirectExecution(
  moduleUrl = import.meta.url,
  entryPath = process.argv[1],
): boolean {
  if (entryPath === undefined) {
    return false;
  }

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    console.error("Failed to start mie MCP server.", error);
    process.exitCode = 1;
  });
}
