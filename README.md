# bource-mcp

**Read-only MCP bridge for the Iran Bourse.** Live Tehran Stock Exchange
(TSETMC) market data + a hard-guarded, authenticated session for TSE portal
pages — installable in one command, wired straight into [opencode](https://opencode.ai)
(or any MCP client).

> **HTTP/GET only. No write tools exist. The browser guard aborts every
> non-GET request client-side.** This bridge is built to *read* the market and
> your portal pages — it cannot place orders, cancel, transfer, or change
> anything. That is a design property, not a promise.

---

## Install (one command)

Requires [Node.js ≥ 18](https://nodejs.org) (Windows path used here:
`C:\Users\User\tools\node\node.exe`).

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Or after the repo is public on GitHub:

```powershell
irm https://raw.githubusercontent.com/a-saeedia/bource-mcp/main/install.ps1 | iex
```

What it does:

1. `npm install` (SDK + Playwright)
2. Downloads Playwright Chromium (one-time, ~150 MB; skip with `-SkipBrowser`)
3. **Auto-registers the `bource` MCP server into your global opencode config**
   (`~/.config/opencode/opencode.jsonc`), with a backup of your previous config
4. Installs a global **`/bourse`** opencode command that drops you straight
   into the market prompt

Then: **restart opencode** → `/mcp` shows `bource` connected → type `/bourse`
or just ask *"is the Tehran market open?"*.

Manual registration (any MCP client):

```jsonc
"mcp": {
  "bource": {
    "type": "local",
    "command": ["C:\\Users\\User\\tools\\node\\node.exe", "C:\\path\\to\\bource-mcp\\server.js"],
    "enabled": true
  }
}
```

---

## Tools

| Tool | What it does |
|---|---|
| `market_status` | Is the Tehran market open (Sat–Wed 09:00–12:30 Asia/Tehran) |
| `search_symbol` | Symbol/name search (فملی، خودرو، …) → `insCode` |
| `get_quote` | Live quote, % change, bid/ask, trades (Rial) + **freshness stamp** |
| `get_order_book` | صف خرید/فروش order book |
| `get_money_flow` | حقیقی/حقوقی retail/institutional flow |
| `get_price_history` | Daily OHLCV history |
| `get_market_watch` | Whole-market snapshot (prefer over per-symbol loops) |
| `get_index_overview` | Index/market overview (bourse / fara-bourse) |
| `session_status` | Which portal sessions exist (never shows credentials) |
| `page_open` | Open TSE portal page with saved read-only session |
| `page_read` | Extract readable text/tables from the open portal page |

---

## Authenticated portal pages (your account)

The model never handles credentials. Once:

```bash
npm run login
```

…opens a **headed** browser to `https://my.tsetmc.com` (override with
`BOURCE_PORTAL_URL`). You log in with your own OTP/credentials, press Enter,
and the cookies are stored **encrypted** (AES-256-GCM, key in `BOURCE_DATA_DIR`).
From then on `page_open` / `page_read` use that session — with **every
non-GET request aborted at the browser level** and navigation restricted to
the exchange allowlist.

---

## Read-only enforcement (layered)

1. **Tool surface** — only read tools are registered; the registry guard
   refuses any non-allowlisted name. No `order_*`/`trade_*` code exists.
2. **HTTP guard** — every upstream call rejects non-GET/HEAD.
3. **Browser guard** — Playwright route interception aborts POST/PUT/PATCH/
   DELETE; downloads cancelled.
4. **Allowlist** — browser navigation only to `my.tsetmc.com`, `tsetmc.com`,
   `tse.ir`, `webgw.tse.ir` (env `BOURCE_ALLOW_HOSTS`).
5. **Secrets hygiene** — encrypted session store; redaction strips tokens,
   cookies, and hex blobs from everything the model sees.

See [SECURITY.md](SECURITY.md) for the full threat model.

---

## Operational notes (from field experience)

- **Run it in Iran.** `cdn.tsetmc.com` favors Iranian IPs and soft-blocks
  foreign/VPN ones. From outside Iran you need an in-Iran relay.
- **Market hours** Sat–Wed 09:00–12:30 (Asia/Tehran). Outside that, live
  quotes are empty — every response is freshness-stamped so stale data is
  never mistaken for live.
- **Rate limits:** the cache + bulk endpoints (`get_market_watch`) exist so
  you don't hammer TSETMC. Keep per-symbol calls sparse.
- Prices are in **Rial**.
- No API key. Unofficial public API — use responsibly; check TSE terms.

---

## Roadmap

- [x] **v0.1** TSE foundation: market data + guarded portal session
- [ ] **v0.2** Structured portfolio extractors (positions / wallet / orders
  history) once the portal schema is confirmed
- [ ] **v0.3** **Saman** exchange adapter (same read-only contract)
- [ ] **v0.4** **Fid (فید)** exchange adapter (same read-only contract)

New exchange adapters implement the same guard layers: read tools only,
GET-only HTTP, browser allowlist, encrypted sessions.

## License

MIT — build on it, fork it, ship it. See [LICENSE](LICENSE).
