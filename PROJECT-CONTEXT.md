# MAET Project — Complete Context for AI Assistants

> **Purpose:** This document is the single source of truth for any AI assistant (Claude Cowork, future sessions, etc.) that needs to work on the MAET project. Read this first before asking questions or making changes.
>
> **Last updated:** 2026-06-23
> **Repo:** https://github.com/tanmay-alpha/MAET
> **Working directory:** `C:\Users\TANMAY\OneDrive\Desktop\MAET`
> **Git user:** Tanmay Mangal
> **Branch:** main (pushed to origin)

---

## 1. What is MAET?

**MAET** is an India stock-market trading platform. It pulls real-time data from NSE/BSE via **Angel One SmartAPI** and **Yahoo Finance**, runs screening and backtests, and exposes a per-user paper-trading flow. It is a monorepo with three workspaces (`src`, `server`, `shared`) and a single Lovable-managed TanStack Start frontend (deployed to Vercel) plus a Nitro backend (deploying to Render).

| Aspect | Value |
|---|---|
| Frontend framework | TanStack Start (Vite + TanStack Router) on Lovable config |
| Backend framework | Nitro (H3) on Node 20 |
| Database | Supabase (Auth + Postgres) — schema not yet wired |
| Cache / pubsub | Upstash Redis (ioredis) |
| Broker | Angel One SmartAPI (REST login + per-user WebSocket) |
| Data fallback | Yahoo Finance (with retry + circuit breaker), NSE scraper |
| Deploy | Vercel (frontend) + Render (backend) — both free tier |
| Cost target | $0/mo on free tiers |
| Last commit | `3dcdd6b` (host bind fix, 2026-06-23) |
| Commits since project audit | 37 (in 3 days) |
| Backend code | 61 TS files, ~6,000 lines |
| Frontend code | 80 TS/TSX files, ~1,700 lines |
| Shared types | 6 files, 266 lines |

---

## 2. Repository structure

```
MAET/
├── .claude/                          # Claude Code memory + skills (project-local)
├── .lovable/                         # Lovable config (managed, do not edit)
├── .playwright-mcp/                  # Playwright MCP test artifacts (gitignored)
├── .vercel/                          # Vercel CLI state (gitignored)
├── .tanstack/                        # TanStack Start cache
├── .vscode/                          # VSCode settings
├── .env                              # Local env vars (gitignored)
├── .env.example                      # Template (tracked)
├── .env.test                         # Dummy env vars for CI (tracked, required)
├── .gitignore
├── .prettierignore, .prettierrc
├── AGENTS.md                         # Lovable connection notice
├── bunfig.toml                       # Bun workspace config (24h minReleaseAge)
├── components.json                   # shadcn/ui config
├── eslint.config.js
├── package.json                      # Root: workspaces = [src, server, shared]
├── bun.lock, package-lock.json       # Both lockfiles coexist (legacy)
├── tsconfig.json                     # Root TS config with @/ paths
├── nitro.config.ts                   # Backend Nitro config (scanDirs = server, shared)
├── render.yaml                       # Render deploy config (do NOT change)
├── vercel.json                       # Vercel deploy config (do NOT change)
├── docs/
│   ├── REMAINING-WORK.md             # Detailed task tracker (2026-06-20 snapshot)
│   └── superpowers/                  # Implementation plans
├── shared/                           # Cross-workspace Zod schemas + symbol data
│   ├── symbols/nifty50.json          # 50 NSE stocks
│   └── types/                        # market.ts, order.ts, screener.ts, errors.ts, index.ts
├── src/                              # FRONTEND (TanStack Start)
│   ├── package.json
│   ├── router.tsx, routeTree.gen.ts  # TanStack Router
│   ├── server.ts                     # SSR entry (normalizes catastrophic 500s)
│   ├── start.ts                      # Start instance with error middleware
│   ├── vite.config.ts                # Lovable config + custom virtual-entry plugin
│   ├── styles.css
│   ├── routes/                       # index, _app, _app.dashboard, _app.terminal, _app.screener, _app.strategies, _app.backtest
│   ├── components/
│   │   ├── app-sidebar.tsx
│   │   ├── trading/                  # 13 trading-specific components (candlestick-chart, order-panel, etc.)
│   │   └── ui/                       # ~30 shadcn primitives (button, dialog, drawer, form, sidebar, table, etc.)
│   ├── hooks/                        # use-live-price, use-live-series, use-mobile
│   └── lib/                          # utils, mock-data, error-capture, error-page, lovable-error-reporting
└── server/                           # BACKEND (Nitro + H3)
    ├── package.json                  # name = "@app/server", start = "HOST=0.0.0.0 node .output/server/index.mjs"
    ├── app.ts                        # CORS + /health route registration
    ├── config.ts, config.test.ts     # Zod env validation (lazy getConfig())
    ├── env.d.ts, tsconfig.test.ts
    ├── api/
    │   └── trpc/                     # auth.ts + auth.test.ts ONLY — routers/ does NOT exist
    ├── routes/
    │   └── health.get.ts             # 200 OK with uptime+checks+version
    ├── data/
    │   ├── redis/{client,client.test,keys}.ts
    │   └── sources/
    │       ├── yahoo.ts, yahoo.test.ts       # Circuit breaker
    │       ├── nse.ts, nse.test.ts           # Fundamentals + corporate actions
    │       └── angelone/{client,client.test,ws}.ts
    ├── domain/
    │   ├── market/{symbol,candle,tick,clock}.ts + .test.ts
    │   ├── screener/{criteria,engine}.ts + .test.ts
    │   └── backtest/strategies.ts + .test.ts  # NO engine.ts
    ├── http/sse/{hub,quotes,hub.test}.ts      # Per-user channel, backpressure
    ├── workers/
    │   ├── yahoo-poller.ts + .test.ts         # 1m poll → bus ticks
    │   ├── angelone-ws.ts + .test.ts          # Per-user WS, exp backoff
    │   ├── candle-writer.ts + .test.ts        # 1m rolling buckets, in-memory
    │   ├── market-clock.ts + .test.ts         # Emits bus:market:phase on change
    │   └── screener-runner.ts + .test.ts      # 30s cache, fundamentals reuse
    └── infra/
        ├── bus.ts + .test.ts                  # Typed EventEmitter
        ├── encryption.ts + .test.ts           # AES-256-GCM
        ├── health.ts + .test.ts               # Stub (checks object is empty)
        ├── idempotency.ts + .test.ts          # withIdempotency(userId, key, fn) with 24h TTL
        ├── logger.ts + .test.ts               # pino with redaction
        └── rate-limit.ts + .test.ts           # Per-user REST + SSE-sub buckets
```

---

## 3. Build, run, test commands

```bash
# Root
bun test                              # Run all tests across workspaces
bun run typecheck                     # tsc --noEmit at root

# Frontend (Vercel deploys this)
cd src
bun run dev                           # Vite dev server (Lovable config)
bun run build                         # TanStack Start → .vercel/output

# Backend (Render deploys this)
cd server
bun run dev                           # nitro dev
bun run build                         # nitro build → .output/
HOST=0.0.0.0 PORT=10000 bun run start  # Run the built server locally (mirrors Render)
bun test                              # Run server tests only
```

**Note:** Tests run with `bun test` (not vitest). The repo uses bun's built-in test runner.

---

## 4. Deployment state (2026-06-23)

| Component | State | Where |
|---|---|---|
| **Frontend** | ✅ Live | https://maet-pi.vercel.app (200 OK) |
| **Backend** | ⚠️ Build passes; **start command was just fixed in commit `3dcdd6b`** (`HOST=0.0.0.0` so Render's health check probe can reach it). Awaiting next Render auto-deploy to verify. | Render service `stock-market-backend` |
| **Backend env vars** | ❓ Need verification in Render dashboard. `render.yaml` declares 11 env vars (3 Supabase, 1 Upstash, 5 Angel One, 1 optional webhook, 1 holiday JSON). 10 of them are `sync: false` — set in dashboard, not from YAML. | Render dashboard |
| **Frontend ↔ Backend** | ❌ Not wired. No `VITE_API_URL` env var on Vercel. Frontend has zero tRPC or API client imports. | Vercel dashboard |
| **DB schema** | ❌ Not created. `server/db/` directory does not exist. Drizzle is in `package.json` deps but unused. | n/a |

---

## 5. What's already built and working (22 of 30 plan tasks)

### Backend
- **Infra:** typed EventEmitter bus, Zod env config, AES-256-GCM encryption, health stub, Redis idempotency (24h TTL + in-flight sentinel), pino logger with redaction, per-user rate limiter (REST 120/min, SSE-sub 50)
- **Data:** ioredis lazy singleton, typed Redis key builders, Yahoo with 3-fail/60s circuit breaker (5-min open), NSE fundamentals + corporate actions scraper, Angel One TOTP login + WebSocket factory
- **Market domain:** 50 NSE quotes (filterable by exchange), 5-phase market clock (PRE_OPEN/OPEN/CLOSED/HOLIDAY/AFTER_HOURS, IST, NSE holidays), candle normalize + gap-fill + corp-action adjust, tick normalize + staleness
- **Screener domain:** Zod DSL with 10 fields (pe, pb, roe, market_cap, dividend_yield, sector, rsi, sma_cross, price_above_sma, volume_spike), 6 ops (eq/gt/lt/gte/lte/between), leaf/AND/OR/criteria shapes, evaluation engine with RSI/AND/OR support
- **Backtest domain:** SMA cross + RSI strategies (no engine yet)
- **Workers (5):** Yahoo poller (1m), Angel One per-user WS (exp backoff), candle writer (1m rolling buckets, in-memory), market clock (emits `bus:market:phase`), screener runner (30s cache + fundamentals reuse)
- **SSE:** SseHub class with per-conn heartbeat, slow-conn timeout, Redis-backed conn/subs indexes; `/api/stream/quotes` handler
- **HTTP:** CORS with explicit-origin allow-list from `FRONTEND_ORIGIN` env (no wildcards), `/health` returns 200 with uptime + checks + version
- **Auth:** Supabase JWT verifier via `jose` (JWKS cache, `requireAuth` + `tryAuth`, `__resetJwksCacheForTests`)

### Frontend
- **Routing:** TanStack Router with 8 routes (`/`, `/dashboard`, `/terminal`, `/screener`, `/strategies`, `/backtest`)
- **Trading components:** 13 components (breadth-gauge, candlestick-chart, depth-meter, flows-widget, live-mini-chart, live-tape, market-heatmap, order-panel, sector-strip, ticker-tape, tilt-card, watchlist, skeleton)
- **Hooks:** `use-live-price` (random walk), `use-live-series` (synthetic chart), `use-mobile`
- **shadcn/ui:** Full primitive set (~30 components)
- **Vercel deploy:** Builds successfully; the `#tanstack-router-entry` blocker from earlier audit was resolved via `src/vite.config.ts:force-virtual-client-entry-and-aliases` plugin

### Shared
- `types/market.ts` (Quote, Exchange, Candle, Tick Zod schemas)
- `types/order.ts` (Order, OrderSide, OrderType, OrderStatus)
- `types/screener.ts` (Criterion DSL — single source of truth, re-exported by `server/domain/screener/criteria.ts`)
- `types/errors.ts` (AppError + UpstreamDegraded/Permanent)
- `symbols/nifty50.json` (50 stocks)

---

## 6. What's NOT done — the 17 remaining gaps

### Critical (blocks end-to-end functionality)

1. **Drizzle schema + migrations (Task 30b)** — `server/db/schema.ts` does not exist. 9 tables needed: `users`, `brokers`, `orders`, `fills`, `candles`, `screener_runs`, `backtest_runs`, `watchlist`, `idempotency`. **#1 blocker** for orders/portfolio/screener-saves/watchlist.

2. **Orders tRPC router (Task 29)** — `server/api/trpc/routers/` directory is missing. No way to place an order from the UI. `order-panel.tsx` is a visual stub with no submit handler.

3. **Screener tRPC router + SSE stream (Task 25)** — `server/realtime/` doesn't exist. `screener-runner.ts` emits `bus:screener:match` events but nothing consumes them.

4. **Backtest engine + tRPC (Task 27)** — Strategies return signals but no harness to run on a date range and persist results.

5. **Portfolio tRPC router (Task 29 cont.)** — No fills, positions, or P&L persisted.

### Operational (blocks "production-ready")

6. **Worker orchestrator + smoke test (Task 30g)** — `server/orchestrator.ts` does not exist. Workers have `.start()` methods but **are never booted**. The deployed Render backend currently serves an empty backend: `/health` returns 200 (empty checks) but no ticks, no candles, no phase events flow. **This is the most urgent fix after the deploy.**

7. **Health checks for upstream deps (Task 30g cont.)** — `server/api/health.get.ts` is missing. Current `server/routes/health.get.ts` only reports the empty checks object. Should ping Yahoo, NSE, Angel One, Redis, DB.

8. **Graceful shutdown helper (Task 30f)** — `server/infra/shutdown.ts` does not exist. Render SIGTERMs on deploys; without a handler, in-flight requests and Redis connections are dropped.

9. **NSE holiday weekly refresh worker (Task 30c)** — `server/workers/nse-holiday-refresh.ts` does not exist. Market clock uses `holidays: Date[]` from static `NSE_HOLIDAYS_JSON` env; NSE publishes new holidays quarterly and backend won't auto-update.

10. **tRPC idempotency wrapper (Task 30e)** — `server/api/trpc/idempotency.ts` does not exist. `withIdempotency(userId, key, fn)` is implemented in `infra/idempotency.ts` but no tRPC procedure calls it. Order placement is vulnerable to double-submits.

11. **Margin / F&O exclusion guard (Task 30h)** — `server/domain/orders/fno-guard.ts` does not exist. SEBI regulations forbid retail traders below a certain threshold from F&O; needs a hard guard in the order validator.

12. **Order state machine + paper broker (Task 28)** — `server/domain/orders/` does not exist. The `Order` type exists in `shared/types/order.ts` but no validator, no state-machine transitions (NEW → VALIDATED → PLACED → FILLED), no paper broker simulator.

13. **Playwright e2e suite (Task 30i)** — `tests/` does not exist. No automated coverage of 6 journeys (login, screener, backtest, place-order, portfolio, sse-stream). Would also catch 14 known follow-up items from earlier workers.

### Connectivity (frontend ↔ backend)

14. **tRPC client in frontend** — `src/` has zero `trpc` or `apiClient` imports. Every page renders from `src/lib/mock-data.ts` (random data) and `use-live-price` (random walk).

15. **VITE_API_URL on Vercel** — Not set in vercel.json or anywhere in the repo. Even if the tRPC client existed, it wouldn't know the Render URL.

16. **SSE subscriber on the frontend** — `use-live-price.ts` is a setInterval random walk. No `EventSource('/api/stream/quotes')` consumer.

17. **Final whole-branch review (Task: Final)** — Audit noted "30% of briefs have small inconsistencies." Tasks 19, 20, 21, 22 each have known follow-ups:
    - AngelOne WS: should emit `user:angelone:auth_failed`, cap reconnects at ~10, remove bare-tick branch
    - CandleWriter.stop(): inline no-op `bus.off(...)` doesn't detach the bound handler
    - SseHub.broadcastTick: `c.send("dropped", ...)` in catch can re-throw; `pending > 50` slow-conn threshold never fires
    - ScreenerRunner.start(): `bus.on("market:phase", () => {})` placeholder is a no-op listener

---

## 7. Concrete next steps (in priority order)

| # | Task | Why it's next | Effort |
|---|---|---|---|
| 1 | **Boot workers in `app.ts`** (one-time glue, no schema needed) | Without this, Render serves an empty backend. `/api/stream/quotes` exists but emits nothing. 1 file change. | XS |
| 2 | **Drizzle schema + migrations (30b)** | All persistence depends on it. 9 tables per audit. | M |
| 3 | **Screener tRPC router + SSE channel (25)** | Closes the loop on the screener (DSL + engine + runner all done). | M |
| 4 | **Orders + paper broker (28, 29)** | Unlocks `order-panel.tsx` submission. Needs #2. | L |
| 5 | **Backtest engine + router (27)** | Closes the loop on backtest (strategies done). | M |
| 6 | **Health check fan-out (30g)** | Required for production. 5 deps: Yahoo, NSE, Angel One, Redis, DB. | S |
| 7 | **Graceful shutdown (30f)** | Required for safe Render deploys. | S |
| 8 | **NSE holiday refresh worker (30c)** | Quarterly cron, ~30 lines. | S |
| 9 | **tRPC idempotency wrapper (30e)** | One middleware. | XS |
| 10 | **Margin/F&O guard (30h)** | Hard guard. SEBI compliance. | S |
| 11 | **tRPC client + VITE_API_URL on Vercel** | Wires frontend to backend. Without it, no backend work is visible. | M |
| 12 | **SSE subscriber in frontend** | Replaces `use-live-price` random walk with real data. | S |
| 13 | **Playwright e2e (30i)** | 6 journeys. Catches 14 follow-up items automatically. | L |
| 14 | **Final whole-branch review** | Adversarial sweep across all 30+ tasks. | L |

---

## 8. Hard constraints (do NOT violate)

These are lessons learned from previous sessions. Violating them will break the build or deploy:

1. **Do NOT change `render.yaml`** — the build/install command is fragile.
2. **Do NOT change `vercel.json`** — the buildCommand chain is fragile.
3. **Do NOT change `vite.config.ts`** — the inline `force-virtual-client-entry-and-aliases` plugin is load-bearing.
4. **Do NOT add `packageManager` field to `server/package.json`** — it has known issues.
5. **Do NOT add `HOST` to `render.yaml` envVars** — leak risk; keep it in the start script.
6. **Do NOT touch frontend files unless the task explicitly requires it** — frontend is currently in a working state and random edits will break Vercel.
7. **Do NOT place test files (`.test.ts`) inside `server/api/`** — Nitro scans `api/` for route handlers and Rollup tries to bundle them; tests with `bun:test` imports break the build. Put tests in `server/infra/`, `server/domain/`, `server/workers/`, etc. instead.
8. **Do NOT use `import { H3 } from "h3"`** — h3 v1.13+ doesn't export a class named `H3`. Use `createApp()` from `h3` (re-exported by `server/app.ts`).
9. **When adding new deps to `server/package.json`, do NOT rely on `bun add` to update `bun.lock` on Render** — Render's `bun install --frozen-lockfile` requires the lockfile to already have the dep. Always commit `bun.lock` alongside `package.json` changes.
10. **Bun's `minimumReleaseAge = 86400` in `bunfig.toml` does NOT exclude the 4 listed `@lovable.dev/*` packages** — those are explicitly in `minimumReleaseAgeExcludes`. jose and other packages are subject to the 24h floor.

---

## 9. Known gotchas and quirks

- **Workers are never auto-started.** `app.ts` does not import or call `.start()` on any worker. You must wire this in explicitly.
- **`getConfig()` is lazy** — only validates env when called. Some modules call it at module load (e.g., `infra/logger.ts`), which means a missing env var will fail-fast on first import.
- **Nitro's node-server preset binds to `[::]` (IPv6 wildcard) by default** unless `HOST=0.0.0.0` is set. Render's free-tier health check probe can't reach IPv6-only binds. This is now fixed in `package.json:start` (commit `3dcdd6b`).
- **Frontend uses mock data everywhere.** `src/lib/mock-data.ts` is the only data source. `use-live-price` simulates ticks with `setInterval`. There is no real backend connection.
- **No `packageManager` field anywhere.** Root `package.json` doesn't have one; workspaces inherit.
- **Both `bun.lock` and `package-lock.json` exist.** The root `package.json` doesn't list deps that need npm, but legacy `package-lock.json` is tracked.
- **Lovable manages the frontend.** Pushes to `main` sync back to Lovable. Don't rewrite git history.
- **The audit's `REMAINING-WORK.md` is outdated** (2026-06-20). It lists 17 pending tasks but doesn't include Tasks 23-30h which are now done. Treat the table in section 7 above as the current source of truth.

---

## 10. Memory and prior session context

Project-local Claude memory lives at `C:\Users\TANMAY\.claude\projects\c--Users-TANMAY-OneDrive-Desktop-MAET\memory\`. Three files exist:

1. **`MEMORY.md`** — index of memory files
2. **`maet-project-audit-2026-06-21.md`** — full project audit from 2026-06-21
3. **`render-nitro-node-server.md`** — Render + Nitro gotchas (host binding, test files in api/, jose install)
4. **`vercel-tanstack-start-build-setup.md`** — Vercel + TanStack Start build quirks (vite config location, virtual entry, alias hack)

If you're using Claude Code or Cowork with project memory enabled, these will be auto-loaded.

---

## 11. Environment variables reference

### Frontend (src/.env or Vercel dashboard)
- `VITE_API_URL` — **NOT SET YET.** Will point to Render backend (e.g., `https://stock-market-backend.onrender.com`).

### Backend (server/.env or Render dashboard)
Required (no defaults):
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (for JWT verification)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (for admin operations)
- `UPSTASH_REDIS_URL` — Upstash Redis connection string
- `ANGELONE_MASTER_KEY` — 32-byte base64 key for AES-256-GCM encryption
- `ANGELONE_API_KEY` — SmartAPI API key
- `ANGELONE_CLIENT_ID` — SmartAPI client code
- `ANGELONE_PIN` — SmartAPI PIN (4-8 digits)
- `ANGELONE_TOTP_SECRET` — SmartAPI TOTP secret (base32, ≥16 chars)

Optional (with defaults):
- `ALERT_WEBHOOK_URL` — Optional webhook for alert routing
- `NSE_HOLIDAYS_JSON` — JSON array of ISO date strings for NSE holidays
- `FRONTEND_ORIGIN` — Comma-separated list of allowed CORS origins. Currently set in `render.yaml` to Vercel URLs.
- `PORT` — Default `3000` (Render sets to `10000`)
- `NODE_ENV` — Default `development`

---

## 12. Test status (as of 2026-06-23)

- **Backend tests:** 53 pass / 8 fail (8 failures are env-caveat — Redis not running in sandbox). No pure-logic regressions. See `docs/REMAINING-WORK.md` for the test baseline.
- **Frontend tests:** None. No test infrastructure set up.
- **E2E tests:** None. `tests/` directory does not exist.

---

## 13. Recent commits (last 10)

```
3dcdd6b fix(server): bind start to 0.0.0.0 so Render health check can reach it
bd0763c fix(server): ensure jose is installed for JWT verifier
5edbc60 feat(server): add Supabase JWT auth middleware and tests
1905001 fix(render): install from workspace root so nitro binary is hoisted
a95e51e chore: ignore .playwright-mcp/ artifacts
0504d68 build(render): use actual deployed Vercel domain in FRONTEND_ORIGIN
4ca7046 build(vercel): copy .vercel/output to project root after build
0bac990 fix(frontend): use absolute @ alias via configResolved
b2f23e6 build(vercel): add .vercelignore to exclude local artifacts
269883d build(vercel): add vercel.json with src/ build command
```

---

## 14. When you (the AI) are stuck

1. **Check the memory files** at `C:\Users\TANMAY\.claude\projects\c--Users-TANMAY-OneDrive-Desktop-MAET\memory\`.
2. **Check `docs/REMAINING-WORK.md`** for historical context on each task.
3. **Check `docs/superpowers/plans/`** for the original task briefs.
4. **Run `bun test` from the root** to see the current test baseline.
5. **Read the existing test files** (e.g., `server/infra/health.test.ts`) to understand the project's testing patterns.
6. **Read `server/infra/bus.ts`** to understand the typed EventEmitter pattern used throughout.
7. **Read `server/domain/screener/criteria.ts`** to see how to re-export from `@shared/types/*` without duplicating Zod schemas.

---

## 15. Communication style with the user

The user (Tanmay) is a solo developer. Preferences:
- **Be concrete:** file paths, line numbers, exact code changes. No vague suggestions.
- **Show your work:** report the exact output of commands, not just "it works."
- **Flag risks early:** if a change might break the deploy, say so before making it.
- **Respect hard constraints:** the 10 constraints in section 8 are non-negotiable.
- **Use the existing patterns:** follow the conventions in `server/infra/*` for infra, `server/domain/*` for domain, `server/workers/*` for workers.
- **Commit messages:** use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`) with a scope prefix (e.g., `feat(server): add screener tRPC router`).
- **Don't rewrite history.** The user is on Lovable which syncs git history. Never force-push or rebase pushed commits.
