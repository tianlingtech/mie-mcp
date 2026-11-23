import {
  ERROR_CODES,
  PROTOCOL_VERSION,
  TOOL_DEFS_VERSION,
} from "@mie/tool-defs";
import { TOOL_DEFINITIONS } from "@mie/tool-defs/schemas";

import type { ToolDefinition } from "./tool-registry.js";

export const P0_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

export const KNOWN_ERROR_CODES = ERROR_CODES;
export const EXPECTED_PROTOCOL_VERSION = PROTOCOL_VERSION;
export const EXPECTED_TOOL_DEFS_VERSION = TOOL_DEFS_VERSION;
