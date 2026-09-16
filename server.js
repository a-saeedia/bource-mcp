#!/usr/bin/env node
/**
 * bource-mcp — read-only MCP bridge for the Iran Bourse.
 *
 * Starts an MCP server over stdio. Register it with opencode:
 *   mcp: { bource: { type: "local", command: ["node", "/abs/path/server.js"], enabled: true } }
 * or run `npm run register` / `install.ps1` to wire it automatically.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './src/registry.js';
import { listSessions } from './src/session-store.js';

const server = new McpServer({
  name: 'bource-mcp',
  version: '0.1.0',
});

registerTools(server);

// Banner goes to stderr — stdout is the MCP transport.
if (process.env.BOURCE_LOG !== '0') {
  const sessions = listSessions();
  console.error(
    `\n[bource-mcp v0.1.0] read-only Iran Bourse bridge ready.` +
      `\n  market data : cdn.tsetmc.com (public, GET-only, no API key)` +
      `\n  portal      : ${sessions.length} saved session(s) (${sessions.map((s) => s.name).join(', ') || 'none — run "npm run login" to attach the TSE portal'})` +
      `\n  contract    : READ-ONLY. No write tools exist. Guarded browser blocks every non-GET request.` +
      `\n  hint        : ask "is the Tehran market open?" or "quote farda" inside opencode.\n`
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
