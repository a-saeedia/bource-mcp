/**
 * Read-only enforcement (layer 1 and 2 of the security model).
 *
 * Layer 1 — tool surface: the registry in registry.js only ever registers
 * tools whose names match the READ_METHODS allowlist below. There is no
 * code path that creates a write tool; grep the repo for "order", "trade",
 * "transfer" and you will only find documentation.
 *
 * Layer 2 — HTTP guard: every outbound request from every adapter funnels
 * through requestReadOnly(), which aborts anything that is not GET/HEAD.
 */
import { ALLOW_HOSTS_DEFAULT } from './hosts.js';

const READ_METHODS = new Set([
  'search_symbol', 'get_quote', 'get_order_book', 'get_money_flow',
  'get_price_history', 'get_market_watch', 'get_index_overview',
  'market_status', 'page_open', 'page_read', 'session_status',
]);

export function isReadTool(name) {
  return READ_METHODS.has(name);
}

export function assertReadToolRegistered(name) {
  if (!isReadTool(name)) {
    throw new Error(
      `[guard] refusing to register "${name}": bource-mcp is read-only by design. ` +
        `Write tools are not implemented anywhere in this bridge.`
    );
  }
}

/** Layer 2 — never allow anything but GET/HEAD against an upstream. */
export function assertReadOnlyMethod(method, url = '') {
  const m = String(method || '').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') {
    throw new Error(`[guard] read-only bridge: blocked ${m} ${url}`);
  }
}

/** Host allowlist matcher (suffix match on hostnames). */
export function allowedHost(rawUrl) {
  const env = process.env.BOURCE_ALLOW_HOSTS;
  const hosts = env ? env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
                    : ALLOW_HOSTS_DEFAULT;
  if (process.env.BOURCE_ALLOW_ALL_HOSTS === '1') return true;
  let host;
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch { return false; }
  return hosts.some((h) => {
    const hh = h.toLowerCase().replace(/^\./, '');
    return host === hh || host.endsWith('.' + hh);
  });
}

const HEX_RE = /\b[0-9a-f]{64,}\b/gi;
const COOKIE_RE = /(?:(?:cookie|set-cookie)\s*[:=]\s*)([^;,`"']+)/gi;
const TOKEN_RE = /\b(?:bearer|token|authorization|sessionid|jsessionid|apikey|api_key|secret|password|passwd|otp)\b[\s:=]+([^\s,;}]+)/gi;

/** Strip anything that smells like a secret from tool output. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  return String(text)
    .replace(COOKIE_RE, (m) => m.replace(/[:=].+$/, ': [redacted]'))
    .replace(TOKEN_RE, (m) => m.replace(/[\s:=]+[^\s,;}]+$/, ' [redacted]'))
    .replace(HEX_RE, '[redacted-hex]');
}

/** Deep-redact any JSON-able structure; strings get passed through redact(). */
export function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
