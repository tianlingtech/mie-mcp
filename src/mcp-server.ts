import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PACKAGE_VERSION } from "./package-info.js";
import type { BridgeRequester, ToolDefinition } from "./tool-registry.js";
import { ToolRegistry } from "./tool-registry.js";

export interface CreateMcpServerOptions {
  bridgeClient: BridgeRequester;
  toolDefinitions: readonly ToolDefinition[];
  defaultTimeoutMs?: number;
}

export function createMcpServer(options: CreateMcpServerOptions): Server {
  const registry = new ToolRegistry(
    options.toolDefinitions,
    options.bridgeClient,
    options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs },
  );
  const server = new Server(
    {
      name: "mie-mcp",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registry.listTools(),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    registry.callTool(request.params.name, request.params.arguments ?? {}),
  );

  return server;
}
