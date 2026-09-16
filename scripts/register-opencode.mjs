/**
 * Auto-register the bource-mcp bridge into the user's opencode config.
 *
 * Writes (or merges) this into the GLOBAL opencode config
 * (~/.config/opencode/opencode.jsonc):
 *
 *   "mcp": {
 *     "bource": {
 *       "type": "local",
 *       "command": ["<node>", "<abs path to server.js>"],
 *       "enabled": true,
 *       "environment": { ... }
 *     }
 *   }
 *
 * Also copies the /bourse opencode slash-command so users land in a prompt
 * that shows exactly what the bridge can do.
 *
 * Usage: node scripts/register-opencode.mjs   (idempotent, safe re-run)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const serverJs = path.join(repoRoot, 'server.js');
const nodePath = process.execPath;

const configDir = path.join(os.homedir(), '.config', 'opencode');
mkdirSync(configDir, { recursive: true });

function findConfig() {
  const candidates = [
    path.join(configDir, 'opencode.jsonc'),
    path.join(configDir, 'opencode.json'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return path.join(configDir, 'opencode.jsonc');
}

function parseJsonc(file) {
  const raw = readFileSync(file, 'utf8');
  // strip // and /* */ comments, keep string contents intact
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
  return JSON.parse(stripped);
}

function writeJsonc(file, obj) {
  const header = '// generated in part by bource-mcp register — edit freely, re-run is idempotent\n';
  writeFileSync(file, header + JSON.stringify(obj, null, 2) + '\n');
}

function backup(file) {
  const bk = file + '.bak';
  if (!existsSync(bk)) copyFileSync(file, bk);
  return bk;
}

// --- main ---
const configFile = findConfig();
const existed = existsSync(configFile);
const backupFile = existed ? backup(configFile) : null;

let config = { $schema: 'https://opencode.ai/config.json' };
if (existed) {
  try {
    config = parseJsonc(configFile);
  } catch (err) {
    console.error(`[bource-mcp] could not parse ${configFile}: ${err.message}`);
    console.error(`[bource-mcp] leaving config untouched. Fix it or restore ${backupFile}.`);
    process.exit(1);
  }
}

config.mcp = config.mcp ?? {};
config.mcp.bource = {
  type: 'local',
  command: [nodePath, serverJs],
  enabled: true,
  environment: {
    BOURCE_DATA_DIR: process.env.BOURCE_DATA_DIR ?? path.join(os.homedir(), '.bource-mcp'),
    BOURCE_PORTAL_URL: process.env.BOURCE_PORTAL_URL ?? 'https://my.tsetmc.com',
  },
};

writeJsonc(configFile, config);
console.log(`[bource-mcp] registered "bource" MCP server in ${configFile}`);
if (backupFile) console.log(`[bource-mcp] previous config backed up to ${backupFile}`);

// Install the global /bourse command so a bare "bourse" slash lands in the prompt.
const cmdDir = path.join(configDir, 'command');
mkdirSync(cmdDir, { recursive: true });
copyFileSync(path.join(repoRoot, '.opencode', 'command', 'bourse.md'), path.join(cmdDir, 'bourse.md'));
console.log('[bource-mcp] global opencode command "/bourse" installed — restart opencode, then type /bourse');

console.log('\nNext step: RESTART opencode. Config is loaded once at startup.');
console.log('Verify with: /mcp  (you should see "bource" connected)');
