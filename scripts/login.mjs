/**
 * Human-only login helper.
 *
 * Why this exists: the bridge is read-only on purpose, and credentials
 * should never travel through the model. You (the human) do the login in a
 * headed browser with OTP / whatever your broker portal needs. When you are
 * done, close the window (or press Enter here) and the session cookies are
 * stored ENCRYPTED on disk. From then on, `page_open`/`page_read` use that
 * session — read-only, with every non-GET request blocked at the browser.
 */
import { chromium } from 'playwright';
import { saveSession } from '../src/session-store.js';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PORTAL_URL = process.env.BOURCE_PORTAL_URL || 'https://my.tsetmc.com';
const SESSION_NAME = 'tse-portal';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Guard is intentionally OFF here — you are the human doing the login.
  acceptDownloads: false,
});
const page = await ctx.newPage();
await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded' });

console.log('\n[bource-mcp] Log in to the portal in the opened browser window.');
console.log('  When you are logged in (you can see your account pages), come back\n' +
            '  here and press Enter. The session will be saved ENCRYPTED.\n' +
            '  Nothing except cookies is stored. Close the browser to abort.\n');

const rl = readline.createInterface({ input: stdin, output: stdout });
await rl.question('Press Enter once logged in... ').catch(() => {});
rl.close();

const cookies = await ctx.cookies();
const saved = saveSession(SESSION_NAME, { cookies, host: new URL(page.url()).hostname, savedAt: new Date().toISOString() });
await browser.close();

console.log(`\n[bource-mcp] session "${saved.name}" saved (host: ${saved.host}).`);
console.log('  opencode can now read — and ONLY read — the portal pages.\n');
process.exit(0);
