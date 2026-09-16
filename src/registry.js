/**
 * Tool registry — the SINGLE place tools are declared.
 *
 * Layer 1 of the security model: assertReadToolRegistered() refuses to
 * register any name that is not on the read-only allowlist. There is no
 * write tool in this project, by construction.
 */
import { z } from 'zod';
import { isReadTool, redactDeep } from './guard.js';
import * as tsetmc from './tsetmc.js';
import * as time from './time.js';
import { openPage, readPage, portalInfo } from './browser.js';
import { listSessions } from './session-store.js';

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(redactDeep(data), null, 2) }] });

export function registerTools(server) {
  const defs = [
    {
      name: 'market_status',
      desc: "Is the Tehran market open right now (Sat–Wed 09:00–12:30 Asia/Tehran)? Local, no network.",
      params: {},
      handler: () => ok(time.marketStatus()),
    },
    {
      name: 'search_symbol',
      desc: 'Search a TSETMC instrument by Persian/English symbol or name (e.g. "فملی", "خودرو", "farda"). Returns insCode + market.',
      params: { query: z.string().min(1).max(64) },
      handler: ({ query }) => tsetmc.searchSymbol(query).then(ok),
    },
    {
      name: 'get_quote',
      desc: 'Live quote for an instrument by insCode (Rial). Stamped with freshness: market_open + staleness_seconds.',
      params: { insCode: z.string().min(1) },
      handler: ({ insCode }) => tsetmc.quote(insCode).then(ok),
    },
    {
      name: 'get_order_book',
      desc: '5-level order book (صف خرید/فروش) for an instrument by insCode.',
      params: { insCode: z.string().min(1) },
      handler: ({ insCode }) => tsetmc.orderBook(insCode).then(ok),
    },
    {
      name: 'get_money_flow',
      desc: 'حقیقی/حقوقی (retail/institutional) money-flow summary for an instrument by insCode.',
      params: { insCode: z.string().min(1) },
      handler: ({ insCode }) => tsetmc.moneyFlow(insCode).then(ok),
    },
    {
      name: 'get_price_history',
      desc: 'Daily OHLCV history (Rial) for an instrument by insCode. Fresh full-market pull is cached 1h.',
      params: {
        insCode: z.string().min(1),
        top: z.number().int().min(1).max(2000).default(260),
      },
      handler: ({ insCode, top }) => tsetmc.priceHistory(insCode, top).then(ok),
    },
    {
      name: 'get_market_watch',
      desc: 'Whole-market snapshot (market=0 all, 1 bourse, 2 fara-bourse, 4 payeh). Prefer this over per-symbol loops.',
      params: {
        flow: z.number().int().min(0).max(4).default(0),
        top: z.number().int().min(1).max(1000).default(200),
      },
      handler: ({ flow, top }) => tsetmc.marketWatch({ flow, top }).then(ok),
    },
    {
      name: 'get_index_overview',
      desc: 'Market overview / index values (flow 1 = bourse, 2 = fara-bourse).',
      params: { flow: z.number().int().min(1).max(2).default(1) },
      handler: ({ flow }) => tsetmc.indexOverview(flow).then(ok),
    },
    {
      name: 'session_status',
      desc: 'Which authenticated portal sessions exist (never exposes credentials) and the browser allowlist.',
      params: {},
      handler: async () => {
        const sessions = listSessions().map((s) => s.name);
        return ok({ sessions, portal: await portalInfo() });
      },
    },
    {
      name: 'page_open',
      desc: 'Open a page on the TSE/TSETMC portal with the saved read-only session. Non-GET requests are blocked.',
      params: {
        url: z.string().url().refine((u) => u.startsWith('https://'), 'https only'),
        waitMs: z.number().int().min(0).max(10_000).default(1500),
      },
      handler: ({ url, waitMs }) => openPage(url, { waitMs }).then(ok),
    },
    {
      name: 'page_read',
      desc: 'Extract readable text (and tables as text) from the currently open portal page. Truncated to maxChars.',
      params: {
        selector: z.string().optional(),
        maxChars: z.number().int().min(500).max(100_000).default(20_000),
      },
      handler: ({ selector, maxChars }) => readPage({ selector, maxChars }).then(ok),
    },
  ];

  for (const def of defs) {
    // Layer 1: the allowlist guard. A non-read name can never be registered.
    if (!isReadTool(def.name)) {
      throw new Error(`[guard] "${def.name}" is not on the read-only tool allowlist — registration refused.`);
    }
    const hasParams = Object.keys(def.params ?? {}).length > 0;
    server.registerTool(
      def.name,
      {
        description: def.desc,
        inputSchema: hasParams ? def.params : undefined,
      },
      async (args) => def.handler(args ?? {})
    );
  }
}
