#!/usr/bin/env node
/**
 * test-genie-mcp v3.0.0 stdio entry point.
 *
 * v2.x was a 700+ line file with a giant `switch (name)` dispatching across
 * 19 tools. v3.0.0 replaces that with a declarative registry living in
 * `core/toolRegistry.ts` and a high-level `McpServer` factory in
 * `core/mcpServerFactory.ts`. Both transports (stdio today, HTTP later)
 * import the same factory and expose an identical tool / resource / prompt
 * surface — no more drift.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer, SERVER_NAME, SERVER_VERSION, getCapabilityCounts } from './core/mcpServerFactory.js';
import { getAllowedRoot } from './security.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const counts = getCapabilityCounts();
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
  console.error(`[capabilities] tools: ${counts.tools}, resources: ${counts.resources}, prompts: ${counts.prompts}`);
  console.error(`[security] Allowed root: ${getAllowedRoot()}`);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
