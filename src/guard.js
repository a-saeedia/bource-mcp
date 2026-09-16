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
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * Layer 5 — secret redaction. Strip session ids, tokens, authorization
 * headers and long hex blobs out of anything that flows back to the model.
 */
const REDACT_PATTERNS = [
  /(Authorization|Cookie|Set-Cookie|x-auth[a-z-]*|session[_-]?id|access[_-]?token|refresh[_-]?token|csrf[_-]?token|jwt)[=:]\s*[^\s,;"']+/gi,
  /(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[0-9a-f]{32,}\b/gi,
];

export function redact(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const re of REDACT_PATTERNS) out = out.replace(re, (m, p1) => (p1 ? `${p1}=[REDACTED]` : '[REDACTED]'));
  return out;
}

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
