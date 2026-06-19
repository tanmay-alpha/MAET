# Stock Market Backend — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Author:** Design session between user and assistant

## 1. Purpose

Replace the existing client-side mock data layer (`src/lib/mock-data.ts`, `src/hooks/use-live-price.ts`) in the TanStack Start app with a real backend that:

- Streams live price ticks for NSE/BSE symbols via Server-Sent Events.
- Serves historical OHLCV candles and fundamentals for chart, screener, and backtest features.
- Lets users place paper-trade orders idempotently against a simulated broker, with a schema that mirrors a future real-broker integration.
- Optionally executes real orders via users' own Angel One SmartAPI accounts (each user supplies their own credentials; the server never shares keys across users).

## 2. Constraints (locked at design time)

| Constraint | Value | Source |
|---|---|---|
| Frontend host | Vercel (existing TanStack Start React app, no rewrite) | User |
| Backend host | Render free Web Service (single Node process, Nitro) | User |
| Live transport | Server-Sent Events (WebSockets not supported on Render free) | Resolved at design |
| Cold-start mitigation | UptimeRobot free tier pings `/health` every 5 min | Resolved at design |
| Live-data source | Angel One SmartAPI WS (per-user) during NSE hours; Yahoo Finance polling fallback | User |
| Historical source | Yahoo Finance + NSE India (scraped) for NSE corporate data | User |
| App authentication | Supabase Auth (email + OAuth), RLS on user-owned tables | User |
| Broker authentication | Each user supplies their own Angel One creds; encrypted at rest with AES-256-GCM | User |
| Persistence | Supabase Postgres + Drizzle ORM (source of truth) | User |
| Ephemeral state | Upstash Redis (tick cache, rate limits, idempotency, SSE presence) | User |
| Tick frequency | 1s heartbeat via `workers/market-clock.ts`; 5s Yahoo batch; Angel One push during market hours | Resolved at design |
| Closed-hours behavior | Quiet SSE stream emits `{ type: "heartbeat", symbol, lastPrice, lastUpdate, stale: true }` every 5s; no synthetic tape | User |
| MVP features | Backtest, real-time screener, paper trading — all in v1 | User |
| Observability | Structured JSON logs (pino) + `/health` endpoint; no OpenTelemetry in MVP | User |
| Trading scope | Paper-only in v1; `paper_*` schema namespaced to keep real-money flow unambiguous | User |
| Idempotency | `Idempotency-Key` header on every order POST; Redis sentinel + Postgres UNIQUE index as backstop | User |
| Cost target | $0/mo (Render free + Vercel free + Supabase free + Upstash free + UptimeRobot free) | User |

## 3. Architecture

Single Nitro process on Render. One HTTP layer (tRPC + SSE), one domain layer (pure logic), one data layer (Postgres + Redis + external sources), one worker layer (long-running jobs). All cross-cutting concerns (bus, logger, rate limit, idempotency, encryption, health) live in `infra/`. The HTTP layer never touches a database directly; the domain layer never imports from HTTP. Workers talk to the world only via a typed in-process `EventEmitter` (`infra/bus.ts`).

```
Browser (TanStack Start, Vercel)
  │ HTTPS REST (tRPC, JWT in cookie)
  │ HTTPS SSE
  ▼
Nitro server (Render free, Node)
  ├─ http/trpc        — REST endpoints (tRPC)
  ├─ http/sse         — SSE handlers + in-process connection registry
  ├─ domain/*         — pure business logic (no I/O)
  ├─ workers/*        — long-running jobs
  ├─ infra/*          — bus, logger, rate-limit, idempotency, encryption, health
  ├─ data/db          — Drizzle + Supabase Postgres
  ├─ data/redis       — Upstash Redis client
  └─ data/sources     — yahoo, nse, angelone (typed wrappers)
                   │
                   ▼
            Postgres + Redis
                   │
                   ▼
       Yahoo · NSE · Angel One
```

## 4. Repository layout

```
project-root/
├── src/                          # React app (existing, ships to Vercel)
│   ├── routes/                   #   tRPC client calls
│   ├── hooks/use-live-price.ts   #   REWRITTEN: subscribes to SSE
│   └── lib/                      #   tRPC client setup
│
├── server/                       # NEW — Nitro backend (ships to Render free)
│   ├── app.ts                    # entrypoint: boots workers, mounts routes
│   ├── config.ts                 # zod-validated env, typed config
│   ├── env.d.ts                  # typed process.env
│   │
│   ├── http/
│   │   ├── trpc/
│   │   │   ├── router.ts         # root router
│   │   │   ├── context.ts        # per-request ctx: userId, supabase, redis
│   │   │   ├── procedures.ts     # authedProcedure, publicProcedure
│   │   │   └── routers/
│   │   │       ├── market.ts     #   quotes.get, candles.get, search
│   │   │       ├── screener.ts   #   screener.run, screener.subscribe
│   │   │       ├── watchlist.ts  #   watchlist.list/add/remove
│   │   │       ├── orders.ts     #   orders.place (idempotent), orders.list
│   │   │       ├── portfolio.ts  #   portfolio.holdings, positions, pnl
│   │   │       ├── backtest.ts   #   backtest.run, backtest.list
│   │   │       └── user.ts       #   user.profile, user.angelone.link
│   │   └── sse/
│   │       ├── quotes.ts         # GET /api/stream/quotes?symbols=...
│   │       ├── screener.ts       # GET /api/stream/screener?id=...
│   │       └── hub.ts            # SSE connection registry, fan-out
│   │
│   ├── domain/                   # pure logic, no HTTP, no SQL
│   │   ├── market/
│   │   │   ├── tick.ts           #   normalization, staleness
│   │   │   ├── candle.ts         #   OHLC aggregation, gap detection
│   │   │   ├── symbol.ts         #   symbol universe, exchange mapping
│   │   │   └── clock.ts          #   MarketClock: NSE hours, holidays, phases
│   │   ├── screener/
│   │   │   ├── engine.ts         #   criteria evaluation
│   │   │   └── criteria.ts       #   criterion Zod DSL
│   │   ├── backtest/
│   │   │   ├── engine.ts         #   walks candles, runs strategy
│   │   │   └── strategies.ts     #   SMA cross, RSI, etc.
│   │   ├── orders/
│   │   │   ├── state-machine.ts  #   order state transitions
│   │   │   ├── validator.ts      #   pre-trade checks
│   │   │   └── paper-broker.ts   #   simulated fills
│   │   └── user/
│   │       └── angelone.ts       #   session lifecycle
│   │
│   ├── data/
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle table defs
│   │   │   ├── client.ts         # Supabase Postgres (Drizzle)
│   │   │   └── migrations/
│   │   ├── redis/
│   │   │   ├── client.ts         # Upstash Redis
│   │   │   └── keys.ts           # typed key builders
│   │   ├── sources/
│   │   │   ├── yahoo.ts
│   │   │   ├── nse.ts
│   │   │   └── angelone/{client.ts, ws.ts}
│   │   └── supabase/auth.ts
│   │
│   ├── workers/
│   │   ├── orchestrator.ts       # start/stop, graceful shutdown
│   │   ├── market-clock.ts       # 1s tick, broadcasts phase changes
│   │   ├── yahoo-poller.ts       # batched 5s polling
│   │   ├── angelone-ws.ts        # per-user WS connection
│   │   ├── nse-scraper.ts        # corporate actions, fundamentals
│   │   ├── candle-writer.ts      # tick → candle aggregation
│   │   └── screener-runner.ts    # evaluate criteria on each tick
│   │
│   └── infra/
│       ├── bus.ts                # typed EventEmitter
│       ├── logger.ts             # pino
│       ├── rate-limit.ts         # per-user token bucket
│       ├── idempotency.ts        # Idempotency-Key middleware
│       ├── encryption.ts         # AES-256-GCM
│       └── health.ts             # /health endpoint
│
├── shared/                       # Zod schemas → TS types (no runtime deps)
│   ├── types/
│   │   ├── market.ts             #   Tick, Candle, Quote
│   │   ├── order.ts              #   Order, Fill, Position
│   │   ├── screener.ts           #   Criterion, Screener
│   │   └── errors.ts             #   typed error code union
│   └── package.json
│
├── package.json                  # tsconfig path aliases: @shared/*
├── tsconfig.json
├── render.yaml                   # Render deploy config (NEW)
└── .env.example                  # all required env vars documented
```

**Import rules (enforced by ESLint `no-restricted-imports`):**
- `http/*` may import from `domain/`, `infra/`, `data/`, `shared/`.
- `domain/*` may import from `infra/`, `shared/`, and other `domain/`. Never from `http/` or `data/`.
- `data/*` may import from `infra/`, `shared/`. Never from `http/` or `domain/`.
- `workers/*` may import from `domain/`, `infra/`, `data/`, `shared/`. Never from `http/`.
- `infra/*` may import from `shared/` only.

## 5. Data flow (six critical paths)

### 5.1 Live tick (hot path)

`[NSE exchange]` → `[data/sources/angelone/ws.ts]` (one connection per active user with creds) → `[domain/market/tick.ts normalize()]` → `[infra/bus.ts emit("tick")]` → fan-out to: `workers/candle-writer.ts` (buffer 1s ticks, flush 1-min candle to DB), `workers/screener-runner.ts` (evaluate criteria), `[http/sse/hub.ts]` (lookup `sse:subs:{symbol}` Redis set, write SSE events to those connections). Target: exchange → browser p99 < 500ms. **No Postgres write on the hot path.** A backed-up SSE client is dropped after 1s of pending writes (heartbeat replaced with `event: dropped`).

### 5.2 Historical candle (cold path)

Browser → tRPC `market.candles` → `[http/trpc/routers/market.ts]` → `[domain/market/candle.ts getCandles()]` → check `cache:candles:{exchange}:{symbol}:{tf}:{from}:{to}` (Redis). On miss: `[data/sources/yahoo.ts getCandles()]` with retry ×2, exp backoff, 5s timeout. Normalize + fill gaps in `domain/market/candle.ts normalizeAndFillGaps()`. Cache write-through to Postgres `candles_1d` (or `candles_1m`) for symbols the user owns/follows. Set Redis TTL: 1h daily, 5m intraday. Never re-fetch cached data unless the user explicitly asks for the latest tail.

### 5.3 Screener

Save: tRPC `screener.save(criteria)` validates via Zod, writes to `screeners` (RLS: owner only). Match path: `bus.emit("tick")` → `workers/screener-runner.ts onTick` → load active screeners for that exchange (cached 30s in `screener:criteria:{exchange}`) → evaluate criteria against `(tick, cached fundamentals)` → if match, `bus.emit("screener:match", { userId, screenerId, symbol, tick })` → SSE hub looks up that user's connections → `event: match` pushed to that user only.

### 5.4 Order placement (idempotent)

Browser → tRPC `orders.place` with `Idempotency-Key: <uuid>` header. Server: (1) `authedProcedure` resolves `userId`; (2) `infra/idempotency.ts` checks Redis `idempotency:{userId}:{key}` — hit returns cached response, miss SETNX a "pending" sentinel with 24h TTL; (3) `domain/orders/validator.ts` checks buying power, market hours, symbol; (4) `domain/orders/state-machine.ts` creates `paper_orders` row with `idempotency_key` (UNIQUE index `(user_id, idempotency_key)` as DB backstop); (5) `domain/orders/paper-broker.ts` fills against next tick; (6) on fill, `bus.emit("order:fill")`; (7) Redis cache updated to final response, EX 86400. Two layers of idempotency: Redis (fast) + Postgres UNIQUE index (durable).

### 5.5 Angel One link

Browser → tRPC `user.angelone.link({ apiKey, password, totpSecret })` → `infra/encryption.ts encrypt()` (AES-256-GCM, key from `process.env.ANGELONE_MASTER_KEY`) → DB upsert `user_angelone_creds` (RLS owner-only, never returned by any API) → `domain/user/angelone.ts tryLogin()` using `otplib` to generate TOTP code → store session in `angelone:session:{userId}` Redis hash, 8h TTL → `bus.emit("user:angelone:ready")` → `workers/angelone-ws.ts` opens SmartAPI WS, subscribes to user's watchlist + screener tokens, re-emits ticks via bus. TOTP secret never leaves the server.

### 5.6 Market clock phase transition

`workers/market-clock.ts` setInterval 1s → `domain/market/clock.ts computePhase(now)` returns `PRE_OPEN|OPEN|CLOSED|HOLIDAY|AFTER_HOURS` (NSE holiday calendar refreshed weekly by `nse-scraper.ts`) → on phase change, `bus.emit("market:phase", newPhase)` → subscribers: `workers/angelone-ws.ts` (open/close WS), `workers/yahoo-poller.ts` (resume/stop), `workers/candle-writer.ts` (start/flush), `http/sse/hub.ts` (broadcast `event: phase` to all clients). The clock is the single source of truth for "is the market on."

## 6. Storage schema

### 6.1 Postgres (Drizzle, snake_case, `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`)

**Identity & user-owned (RLS enabled, owner-only)**

- `user_profiles(user_id PK FK auth.users, display_name, preferences jsonb)`
- `user_angelone_creds(user_id PK, enc_blob bytea, iv bytea, auth_tag bytea, updated_at)` — server-only reads
- `watchlists(user_id, name, symbols text[])` — many per user

**Market data (shared, RLS read-public, write-server-only)**

- `symbols(exchange, symbol, name, token, yahoo_ticker, nse_url_slug, is_active)` — loaded once on startup from bundled JSON, refreshed weekly
- `candles_1d(symbol, date, open, high, low, close, volume)` — PK `(symbol, date)`, index `(symbol, date desc)`
- `candles_1m(symbol, ts, open, high, low, close, volume)` — PK `(symbol, ts)`, monthly partitioning once > 100k rows
- `fundamentals(symbol, as_of date, pe, pb, roe, market_cap, dividend_yield, sector, industry, raw jsonb)` — PK `(symbol, as_of)`
- `corporate_actions(symbol, ex_date, action enum, ratio|amount)` — adjusts historical prices

**User-generated compute (RLS owner-only)**

- `screeners(user_id, name, criteria jsonb, is_active)` — criteria validated by Zod
- `screener_runs(id, user_id, screener_id, matched_at, symbol, tick_price)` — 30-day TTL
- `backtest_runs(user_id, name, params jsonb, result jsonb, started_at, finished_at, status)`

**Trading — paper-only namespace**

- `paper_orders(user_id, symbol, side, qty, type, limit_price?, status, idempotency_key, placed_at, filled_at?)` — UNIQUE `(user_id, idempotency_key)`, status enum `pending|partial|filled|cancelled|rejected`
- `paper_fills(order_id FK, qty, price, ts)` — cascade delete with parent
- `paper_positions(user_id, symbol, qty, avg_price, realized_pnl, updated_at)` — UNIQUE `(user_id, symbol)`
- `paper_ledger(user_id, ts, kind enum, amount)` — `DEPOSIT|WITHDRAW|FEE|ADJUST`, starting balance ₹1,00,000 seeded on first login

**RLS policy pattern** (applied to every table with `user_id`):

```sql
create policy "own rows read" on <table> for select using (user_id = auth.uid());
create policy "own rows write" on <table> for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Nitro server uses a **service-role key** for worker-side writes (intentionally bypasses RLS; worker trusts itself). All user-driven tRPC routes use the **user JWT** and rely on RLS.

### 6.2 Redis (Upstash free, all keys prefixed, TTL on every key)

| Key pattern | Type | TTL | Purpose |
|---|---|---|---|
| `cache:quote:{exchange}:{symbol}` | string (JSON) | 60s | Latest tick per symbol |
| `cache:candles:{exchange}:{symbol}:{tf}:{from}:{to}` | string (JSON) | 1h daily / 5m intraday | Historical candle cache |
| `angelone:session:{userId}` | hash | 8h | Angel One session tokens |
| `angelone:subs:{userId}` | set of tokens | 1h, refreshed on subscribe | Subscribed tokens per user |
| `sse:conn:{connId}` | hash | 30s, renewed on heartbeat | Active SSE connection state |
| `sse:subs:{symbol}` | set of connIds | 30s | Reverse index: connections per symbol |
| `ratelimit:rest:{userId}:{minute}` | counter | 60s | REST calls per minute |
| `ratelimit:sse:subs:{userId}` | counter | 60s | Active SSE subscriptions per user |
| `idempotency:{userId}:{key}` | string (JSON) | 24h | Cached order response |
| `screener:criteria:{exchange}` | string (JSON) | 30s | Cached active screeners per exchange |

**Upstash free tier reality:** 256MB storage, 10k commands/day. At MVP scale (~500 active SSE connections × 50 symbols) we hit ~5MB storage, but the **10k cmd/day ceiling is the binding constraint**. Documented upgrade path: switch to Upstash pay-as-you-go ($0.20/100k commands) once daily command count exceeds 5k sustained. Pipelines are mandatory in hot paths to amortize command count: a single tick that updates `cache:quote:*`, `sse:conn:*` renewals, and `sse:subs:*` membership uses one `MULTI/EXEC` transaction, not three round-trips.

### 6.3 Backups & retention

- **Postgres:** Supabase free tier gives 7-day PITR. Sufficient for MVP. Upgrade to daily snapshots if real money is added.
- **Redis:** no backups. Everything rebuildable from Postgres or upstream sources.
- **Candles:** `candles_1m` partitions older than 5 years roll to Supabase Storage parquet nightly. `candles_1d` retained forever.
- **Screener runs / backtest runs** older than 90 days pruned nightly unless user-starred.

## 7. Error handling

### 7.1 Four categories

| Category | Examples | Recovery |
|---|---|---|
| Upstream transient | Yahoo 429, NSE 503, Angel One WS drop | Retry w/ backoff, circuit-break, hot path serves cached. |
| Upstream permanent | Symbol delisted, NSE HTML change, invalid API key | Surface 4xx. No retry. |
| User input | Invalid Zod, ticker not found, bad criteria | 400 with typed error code. |
| Worker / system | OOM, unhandled throw, DB pool exhausted | Pino log. `/health` flips degraded/down. Optional Discord webhook alert (env var `ALERT_WEBHOOK_URL`; if unset, alerts degrade to log-only with no functional impact). |

### 7.2 Per-source handlers

- **Yahoo** — `withRetry(fn, { tries: 3, baseMs: 200, factor: 2, jitterMs: 100 })`. 429 honors `Retry-After`. Per-host circuit breaker: 10 fails / 60s → open 5 min, fail fast as `UpstreamDegradedError`.
- **Angel One WS** — auto-reconnect exp backoff capped 30s. Resubscribe watchlist + screener tokens on reconnect. `invalid_token` → emit `user:angelone:auth_failed`, prompt re-link.
- **NSE scraper** — detect captcha HTML by regex, treat as transient. Structure change → `UpstreamPermanentError` with diff, alert via Discord webhook.

### 7.3 tRPC error code union (in `shared/types/errors.ts`)

`UNAUTHORIZED | FORBIDDEN | RATE_LIMITED | IDEMPOTENT_REPLAY | UPSTREAM_DEGRADED | UPSTREAM_PERMANENT | VALIDATION_FAILED | MARKET_CLOSED | INSUFFICIENT_BUYING_POWER`

Server formatter returns `{ code, message, data? }`, never stack traces.

### 7.4 Worker lifecycle

`workers/orchestrator.ts` wraps each worker in `withGracefulShutdown(workerFn)`: on `SIGTERM`/`SIGINT`, set shutdown flag, wait ≤30s for in-flight tasks, close pools, exit. On uncaught exception: log, restart after 5s with fresh context. Three consecutive crashes of one worker → health flips to `down`, alert.

### 7.5 `/health` endpoint

Returns 200 if all workers report `lastHeartbeat < 30s ago`, DB pool < 80% used, Redis ping < 200ms. Otherwise 503 with per-worker status. Body: `{ status, uptime, checks: { yahoo, angelone, nse, marketClock, db, redis }, version }`. UptimeRobot pings every 5 min.

### 7.6 SLOs

| Path | SLO |
|---|---|
| Tick exchange → SSE write | p99 < 500ms |
| `quotes.get` (cached) | p99 < 50ms |
| `candles.get` (cached) | p99 < 100ms |
| `candles.get` (cold) | p99 < 3s |
| Order placement (paper) | p99 < 200ms |
| `/health` response | p99 < 100ms |

## 8. Testing (five layers)

| Layer | Tool | Scope | What it catches |
|---|---|---|---|
| Unit | Vitest | `domain/*`, `infra/*` (bus stubbed) | Pure logic bugs, state-machine edges, time math |
| Integration | Vitest + testcontainers (Postgres, Redis) | `data/*`, tRPC routers with real DB | RLS policy holes, idempotency races, candle aggregation |
| Contract | Zod round-trip + tRPC typegen | `shared/*` | Schema drift between client and server |
| E2E | Playwright (upstream sources mocked) | 6 user journeys | Frontend-to-backend flow integrity |
| Load / chaos | k6, nightly | Staging | Capacity, backpressure, recovery from upstream failure |

### Unit targets (per-folder, not global)

- `domain/`: 80% line coverage
- `infra/`: 70% line coverage

### Six E2E journeys (one test each)

1. Sign up → empty dashboard.
2. Add RELIANCE → SSE event within 5s.
3. Open chart → 1-month daily candles render.
4. Save screener P/E < 30 → match toast on next matching tick.
5. Paper BUY 10 RELIANCE → `paper_orders` row with `status=filled` within 2s.
6. Same order replayed with same idempotency key → exactly one row, identical response.

### Anti-patterns we explicitly avoid

- No flaky E2E. If a test flakes twice, replace it with a focused integration test.
- No snapshot tests on time-dependent data. Test shape and invariant, not byte-for-byte.
- No coverage as a CI gate. Per-PR question: "what test would have caught this?" Add it if the answer is "none."

## 9. Out of scope (MVP)

- Real-money order execution via Angel One (the integration point exists in `domain/orders/` but the real-broker dispatch path is not wired).
- US/global markets. India (NSE/BSE) only.
- Mobile app. Web responsive only.
- Push notifications (browser or mobile). In-app toasts via SSE only.
- Multi-region deployment. Single Render instance.
- OpenTelemetry / Prometheus / Sentry. Structured logs + `/health` only.
- User-to-user social features (shared screeners, leaderboards, copy-trading).
- Margin trading, F&O, currency derivatives. Equity delivery only in v1.

## 10. Open questions for implementation phase

These are intentionally deferred to the writing-plans stage:

1. **Yarn vs pnpm vs bun** for the workspace — the design assumes TS path aliases work; specific package manager can be decided in the plan.
2. **Bun runtime on Render** — Render supports Bun natively. Decision affects the deploy script in `render.yaml`. If Bun is chosen, all `package.json` scripts use `bun run`.
3. **Initial symbol universe bundle** — ship with NIFTY 50 + NIFTY 500? Or full NSE equity list (~2000)? Affects bundle size and the first-load worker.
4. **Drizzle migration tooling** — `drizzle-kit generate` + `drizzle-kit migrate` vs in-app migrations on boot. Both are valid.
5. **Angel One rate limits** — SmartAPI has 1 req/sec REST limit. We need to confirm WS connection count limits for free-tier accounts before finalizing `angelone-ws.ts` design.

---

**Approved sections (during brainstorming):**
- [x] Section 1 — Architecture
- [x] Section 2 — Components
- [x] Section 3 — Data flow
- [x] Section 4 — Storage schema
- [x] Section 5 — Error handling
- [x] Section 6 — Testing

**Next step:** invoke the `superpowers:writing-plans` skill to produce an implementation plan from this spec.
