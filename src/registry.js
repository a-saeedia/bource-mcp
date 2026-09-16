/**
 * Tool registry — the ONLY place tools are created.
 *
 * Security model layer 1: every name must pass assertReadToolRegistered()
 * (isReadTool allowlist). There is no write path anywhere; if a name isn't
 * on the allowlist the server refuses to start. Adapters live in src/ and
 * are imported here and wrapped into zod-schema'd tools.
 *
 * SDK: @modelcontextprotocol/sdk 1.30.0 — object-style registerTool API.
 */
import { z } from 'zod';
import {
  quote, orderBook, moneyFlow, priceHistory, marketWatch,
  indexOverview, searchSymbol,
} from './tsetmc.js';
import { openPage, readPage, sessionMeta } from './browser.js';
import { isMarketOpen, tehranNow, nextOpen } from './time.js';
import { assertReadToolRegistered, redact } from './guard.js';

const insCode = (label) => z.string().describe(label);

function register(server, name, schema, fn) {
  assertReadToolRegistered(name);
  server.registerTool(name, { description: schema.description, inputSchema: schema.shape }, fn);
}

export function registerTools(server) {
  register(server, 'market_status', {
    description: 'Is the Tehran Stock Exchange market open right now (Sat–Wed 09:00–12:30 Asia/Tehran)? Returns session state and next open day.',
    shape: z.object({}),
  }, async () => {
    const t = tehranNow();
    return {
      open: isMarketOpen(),
      now_tehran: `${t.date} ${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')} (${t.dow})`,
      session: 'Sat–Wed 09:00–12:30 Asia/Tehran',
      next_open: nextOpen(),
    };
  });

  register(server, 'search_symbol', {
    description: 'Search the Tehran Stock Exchange instrument list by Persian symbol (فملی) or partial English name (farda). Returns insCode(s) to use with get_quote/get_order_book/get_money_flow.',
    shape: z.object({ query: z.string().min(1).describe('symbol or name fragment') }),
  }, async ({ query }) => redact(await searchSymbol(query)));

  register(server, 'get_quote', {
    description: 'Live quote for an instrument by insCode: last/closing price, change %, OHLC, volume, value, trades, plus a freshness stamp (Rial).',
    shape: z.object({ insCode: insCode('17-digit TSETMC instrument code from search_symbol') }),
  }, async ({ insCode: code }) => redact(await quote(code)));

  register(server, 'get_order_book', {
    description: 'Order book (صف خرید/فروش) for an instrument by insCode: 5 price levels with bid/ask volume and order counts.',
    shape: z.object({ insCode: insCode('17-digit TSETMC instrument code from search_symbol') }),
  }, async ({ insCode: code }) => ({ levels: redact(await orderBook(code)) }));

  register(server, 'get_money_flow', {
    description: 'Retail vs institutional (حقیقی/حقوقی) buy/sell flow for an instrument by insCode, in shares.',
    shape: z.object({ insCode: insCode('17-digit TSETMC instrument code from search_symbol') }),
  }, async ({ insCode: code }) => redact(await moneyFlow(code)));

  register(server, 'get_price_history', {
    description: 'Daily OHLCV history for an instrument by insCode (most recent N sessions, default 60, max 260).',
    shape: z.object({
      insCode: insCode('17-digit TSETMC instrument code from search_symbol'),
      top: z.number().int().min(1).max(260).default(60).describe('number of sessions (default 60)'),
    }),
  }, async ({ insCode: code, top }) => ({ sessions: redact(await priceHistory(code, top)) }));

  register(server, 'get_market_watch', {
    description: 'Whole-market snapshot: top movers, prices, volumes for every instrument (bourse flow=0/1, fara-bourse=2). Prefer this over per-symbol loops.',
    shape: z.object({
      flow: z.number().int().min(0).max(4).default(0).describe('market: 0=all, 1=bourse, 2=fara-bourse, 3=options'),
      top: z.number().int().min(1).max(1000).default(200).describe('max rows to return'),
    }),
  }, async ({ flow, top }) => ({ instruments: redact(await marketWatch({ flow, top })) }));

  register(server, 'get_index_overview', {
    description: 'Market index overview for bourse (1) or fara-bourse (2): index value, change, trades, volume, value today.',
    shape: z.object({ flow: z.number().int().min(1).max(2).default(1).describe('1=bourse, 2=fara-bourse') }),
  }, async ({ flow }) => redact(await indexOverview(flow)));

  // ---- portal (browser) tools — read-only, guarded ----

  register(server, 'session_status', {
    description: 'Which TSE portal sessions exist (name + save time). Shows no credentials. Requires a login once via `npm run login` before page_open.',
    shape: z.object({}),
  }, async () => redact(sessionMeta()));

  register(server, 'page_open', {
    description: 'Open an https:// page on the TSE portal allowlist (my.tsetmc.com / tsetmc.com / tse.ir / webgw.tse.ir) using the saved read-only session. Navigation to any other host is refused.',
    shape: z.object({
      url: z.string().describe('https URL on an allowed exchange host'),
      session: z.string().default('tse-portal').describe('session name from session_status'),
    }),
  }, async ({ url, session }) => redact(await openPage({ url, session })));

  register(server, 'page_read', {
    description: 'Read readable text/tables from the currently open portal page (nothing actionable — GET-only, redacted).',
    shape: z.object({}),
  }, async () => ({ text: await readPage() }));
}
