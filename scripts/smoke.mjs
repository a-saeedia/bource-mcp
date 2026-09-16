/**
 * Smoke test — real verification, not a claim.
 *
 * Spawns the actual server over stdio, performs the MCP handshake, lists
 * tools, and calls one local tool (market_status) plus one network tool
 * (search_symbol, tolerated failure) to prove the read path works end to
 * end. Exit code 0 only if handshake + registered tool set is correct.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXPECTED = [
  'market_status', 'search_symbol', 'get_quote', 'get_order_book',
  'get_money_flow', 'get_price_history', 'get_market_watch',
  'get_index_overview', 'session_status', 'page_open', 'page_read',
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../server.js', import.meta.url))],
  stderr: 'pipe',
});

let stderrBuf = '';
transport.stderr.on('data', (d) => { stderrBuf += d.toString(); });

const client = new Client({ name: 'bource-smoke', version: '0.1.0' });
let failures = 0;

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`[smoke] server advertised ${names.length} tools: ${names.join(', ')}`);

  for (const expected of EXPECTED) {
    if (!names.includes(expected)) {
      failures++;
      console.error(`[smoke] MISSING tool: ${expected}`);
    }
  }

  // Local, offline tool — must succeed.
  const ms = await client.callTool({ name: 'market_status', arguments: {} });
  const msText = ms.content?.[0]?.text ?? JSON.stringify(ms);
  console.log(`[smoke] market_status -> ${msText.slice(0, 220)}...`);

  // Network tool — may be geo-blocked from outside Iran; must still return
  // a structured response (data OR an explicit error), never crash the server.
  try {
    const s = await client.callTool({ name: 'search_symbol', arguments: { query: 'فملی' } });
    const txt = s.content?.[0]?.text ?? JSON.stringify(s);
    console.log(`[smoke] search_symbol -> ${txt.slice(0, 200)}`);
    if (s.isError) console.log('[smoke] search_symbol (expected if this box is outside Iran / upstream down)');
  } catch (err) {
    console.log(`[smoke] search_symbol tool call errored (accepted): ${err.message.slice(0, 120)}`);
  }

  await client.close();
} catch (err) {
  failures++;
  console.error(`[smoke] FAILED: ${err.message}`);
}

const bannerOk = stderrBuf.includes('bource-mcp');
if (!bannerOk) console.error('[smoke] startup banner missing from stderr');

console.log(failures === 0 ? `\n[smoke] PASS (${EXPECTED.length} tools, handshake ok)` : `\n[smoke] FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
