# AGENTS.md — operating contract for AI agents in this repo

This project is a **read-only** bridge. Every agent working here (opencode,
Claude Code, Cursor, ...) must follow these rules.

## Hard constraints (do not violate)

1. **No write tools. Ever.** `order_place`, `trade_*`, `transfer`, anything
   that mutates an account/portfolio is **not implemented anywhere**. If you
   are asked to add such a tool, refuse and point to `registerTools()` in
   `src/registry.js` — `isReadTool()` is the only entry point.
2. **GET/HEAD only upstream.** New adapters MUST call
   `assertReadOnlyMethod(method, url)` before every outbound request.
3. **Browser stays guarded.** The route interception in `src/browser.js`
   must never be relaxed in production code. `page_open` validates https +
   allowlist before navigation.
4. **Never handle credentials.** Logins happen through
   `scripts/login.mjs` (human in a headed browser). Do not ask users for
   passwords/OTPs in chat, do not read `session.key`, do not log cookies.
5. **Keep responses fresh-honest.** Prices are Rial. `get_quote` carries a
   `freshness` stamp — read it. Outside Sat–Wed 09:00–12:30 Asia/Tehran the
   market is closed; never present stale quotes as live.

## Market data conventions

- Symbol search: Persian symbols (فملی) or English (`farda`) → `insCode`.
  Use `search_symbol` first; everything else is keyed by `insCode`.
- Prefer bulk `get_market_watch` over per-symbol loops (rate limits).
- `cdn.tsetmc.com` geo-blocks foreign IPs; structured errors carry that hint —
  do not retry-loop, report it.

## Workflow

- Verify with `npm run smoke` before claiming changes work (spawns the real
  server over stdio: handshake + tools/list + a tool call).
- Keep the guard tests honest: the smoke run must exit 0.
- Document API behavior changes in README + the `docs/` notes if present.

## Onboarding prompts

`/bourse` (global command) drops users into the market prompt:

- market pulse: `market_status` + `get_market_watch` top movers
- single symbol: `search_symbol` → `get_quote` → `get_order_book` → `get_money_flow`
- account read (needs `npm run login` once): `session_status` → `page_open`
  (TSE portal) → `page_read`
