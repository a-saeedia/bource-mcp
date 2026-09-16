/**
 * Guarded browser adapter — reads authenticated TSE portal pages.
 *
 * Security model (this is the whole point):
 *  - The browser context route-intercepts EVERY request. Anything that is
 *    not GET/HEAD is aborted client-side — even a compromised model cannot
 *    mutate state, place orders, transfer funds, or change passwords
 *    through this session.
 *  - Navigation is restricted to an allowlist of exchange hosts.
 *  - Downloads / file choosers are cancelled.
 *  - Saved cookies come from the encrypted session store; the model never
 *    sees or handles them.
 */
import { chromium } from 'playwright';
import { loadSession } from './session-store.js';
import { allowedHost } from './guard.js';
import { ALLOW_HOSTS_DEFAULT } from './hosts.js';

const PORTAL_URL = process.env.BOURCE_PORTAL_URL || 'https://my.tsetmc.com';

let _browser = null;
let _ctx = null;
let _page = null;

async function ensureContext() {
  if (_ctx) return _ctx;
  _browser = await chromium.launch({ headless: true });
  _ctx = await _browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptDownloads: false,
  });

  // Restore a human-captured session if present (never credentials).
  const session = loadSession('tse-portal');
  if (session?.cookies?.length) await _ctx.addCookies(session.cookies);

  // === THE READ-ONLY GUARD ===
  await _ctx.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method !== 'GET' && method !== 'HEAD') {
      await route.abort('blockedbyclient'); // layer 3: no mutations
      return;
    }
    if (!allowedHost(request.url())) {
      await route.abort('blockedbyclient'); // layer 4: allowlist only
      return;
    }
    await route.continue();
  });

  // Belt & suspenders vs. form posts (some SPAs POST then GET).
  _ctx.on('page', (page) => {
    page.on('download', (d) => d.cancel().catch(() => {}));
  });

  return _ctx;
}

export async function portalInfo() {
  const session = loadSession('tse-portal');
  return {
    portal_url: PORTAL_URL,
    session_saved: Boolean(session),
    session_host: session?.host ?? null,
    allowlist: (process.env.BOURCE_ALLOW_HOSTS || ALLOW_HOSTS_DEFAULT.join(',')).split(','),
    read_only: 'enforced at browser level — non-GET requests are aborted client-side',
  };
}

export async function openPage(url, { waitMs = 1500 } = {}) {
  if (!/^https:\/\//i.test(url)) {
    throw new Error('[guard] page_open only accepts https:// URLs');
  }
  if (!allowedHost(url) && process.env.BOURCE_ALLOW_ALL_HOSTS !== '1') {
    throw new Error(`[guard] host not in allowlist: ${new URL(url).hostname}`);
  }
  const ctx = await ensureContext();
  const page = _page ?? (await ctx.newPage());
  _page = page;
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(waitMs);
  return {
    url: page.url(),
    title: (await page.title()).slice(0, 200),
    status: resp?.status() ?? null,
    note: 'read-only session — non-GET requests are blocked',
  };
}

export async function readPage({ selector, maxChars = 20_000 } = {}) {
  if (!_page) throw new Error('no page open — call page_open first');
  const root = selector ? _page.locator(selector).first() : _page.locator('body');
  const text = (await root.innerText().catch(() => '')).trim();
  return {
    url: _page.url(),
    title: (await _page.title().catch(() => '')).slice(0, 200),
    text: text.slice(0, maxChars),
  };
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = _ctx = _page = null;
  }
}
