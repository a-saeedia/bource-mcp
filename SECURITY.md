# Security — bource-mcp

## Threat model

The attacker we defend against is the **agent itself** (a compromised or
confused LLM session) and anything that can trick it into issuing a
"malicious" tool call. Secondarily: secrets at rest if disk is stolen.

Assets: market data (public, low value), portal session (high value, can
read account pages), credentials (never stored).

## Defense layers (all must hold)

| # | Layer | Enforcement | Failure mode if removed |
|---|---|---|---|
| 1 | Tool surface | `src/registry.js` registers only names on `isReadTool()` allowlist | an agent could be handed a write tool |
| 2 | HTTP guard | `assertReadOnlyMethod()` rejects non-GET/HEAD; every adapter funnels through it | a bad adapter could POST mutations to the exchange |
| 3 | Browser guard | Playwright route interception aborts non-GET/HEAD requests, downloads cancelled | the agent could mutate state via the portal web UI |
| 4 | Navigation allowlist | `page_open` and the interceptor check host allowlist (`src/hosts.js`) | the session cookie could be exfiltrated to an attacker host |
| 5 | Secrets hygiene | encrypted session store (AES-256-GCM); `redactDeep()` strips tokens/cookies/hex from all tool output | credentials or session tokens leak into the model or logs |

## Rules for contributors

- A new adapter = 1 new file in `src/` + 1 entry in `registry.js` (read-only
  name) + calls `assertReadOnlyMethod` on every request + (if browser) keeps
  the route guard. That is the entire API surface.
- Never disable `BOURCE_ALLOW_ALL_HOSTS` in production.
- Never log cookies, tokens, or `session.key` content — logs only count/type.
- `scripts/login.mjs` is the ONLY place credentials are handled, and only as
  a human-in-the-loop OTP login; the result saved is cookies only.

## Reporting

Open an issue on the repo. This is an unofficial read-only bridge to a
public API — always verify against TSE official channels before acting on
any data.
