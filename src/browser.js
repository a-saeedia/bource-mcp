/**
 * Guarded Playwright browser for the TSE investor portal.
 *
 * Designed so that a confused agent can read authenticated pages but CANNOT
 * mutate anything: route interception aborts every non-GET/HEAD request and
 * cancels downloads; navigation is restricted to the host allowlist;
 * credentials never touch the model (cookies come from the encrypted store
 * only, and token-bearing strings are redacted from tool output).
 */
import { chromium } from 'playwright';
import { allowedHost, redact } from './guard.js';
import { loadSession, listSessions } from './session-store.js';

export const PORTAL_URL = process.env.BOURCE_PORTAL_URL || 'https://my.tsetmc.com';

let _browser = null;
let _page = null;
let _guardActive = false;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({ headless: true });
  return _browser;
}

export async function openSession({ session = 'tse-portal' } = {}) {
  const cookies = loadSession(session);
  if (!cookies) {
    throw new Error(
      `no saved session "${session}" — run "npm run login" once (human OTP login in a headed browser), ` +
        `or pass a session name that exists. Sessions: ${listSessions().map((s) => s.name).join(', ') || 'none'}`
    );
  }
  const ctx = await (await getBrowser()).newContext();
  const page = await ctx.newPage();
  await installGuards(ctx);
  await ctx.addCookies(cookies);
  _page = page;
  _guardActive = true;
  return page;
}

function installGuards(ctx) {
  // Layer 3 — browser-level read-only enforcement.
  awaitable(ctx.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      await route.abort('blockedbyclient');
      return;
    }
    // Allow only allowlisted hosts (exfil/redirect guard).
    if (!allowedHost(req.url())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  }));
  ctx.on('download', (d) => d.cancel().catch(() => {}));
}

function awaitable(p) {
  if (p && typeof p.then === 'function') p.catch(() => {});
}

export async function openPage(url) {
  if (!/^https:/i.test(String(url))) throw new Error('[guard] page_open only allows https:// URLs');
  if (!allowedHost(url)) throw new Error(`[guard] ${url} is not on the allowlist`);
  const page = _page || (await openSession());
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  return { url: page.url(), title: (await page.title())?.slice(0, 200) ?? null, guarded: _guardActive };
}

export async function readPage() {
  if (!_page) throw new Error('no open page — call page_open first');
  const text = await _page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,img,canvas').forEach((n) => n.remove());
    return (clone.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 14_000);
  });
  return redact(text);
}

export async function closeSession() {
  if (_browser) { try { await _browser.close(); } catch {} }
  _browser = null; _page = null; _guardActive = false;
}

export function sessionMeta() {
  return {
    portal: PORTAL_URL,
    sessions: listSessions().map((s) => ({ name: s.name, saved_at: new Date(s.savedAt).toISOString() })),
    guard_active: _guardActive,
    page_open: Boolean(_page),
    current_url: _page ? (_page.url() || null) : null,
  };
}
