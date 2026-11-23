import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export class McpHarness {
  readonly stderr: string[] = [];
  private closed = false;

  constructor(
    readonly client: Client,
    readonly transport: StdioClientTransport,
  ) {}

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.client.close();
  }
}

export async function startMcpClient(
  tempDirectory: string,
  environment: Record<string, string> = {},
): Promise<McpHarness> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "index.js")],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      TMPDIR: tempDirectory,
      MIE_PROFILE_REGISTRY_DIR: join(tempDirectory, "profiles"),
      ...environment,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "mie-mcp-e2e", version: "1.0.0" });
  const harness = new McpHarness(client, transport);
  transport.stderr?.on("data", (chunk: Buffer) => {
    harness.stderr.push(chunk.toString("utf8"));
  });
  await client.connect(transport);
  return harness;
}
