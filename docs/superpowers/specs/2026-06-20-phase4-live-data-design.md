# Phase 4 Live Data Pipeline — Tasks 18–22

> **Date:** 2026-06-20
> **Status:** approved (brainstorming)
> **Scope:** Tasks 18 (Yahoo poller), 19 (Angel One WS worker), 20 (Candle writer), 21 (SSE hub), 22 (Market clock worker)
> **Plan:** `docs/superpowers/plans/2026-06-19-stock-market-backend.md` (§ Phase 4)
> **Resumes:** `docs/REMAINING-WORK.md` (will be refreshed as part of this work)

---

## Goal

Wire the live-ticks hot path end-to-end so that:

1. Tick data flows from Yahoo and Angel One into a single internal event bus.
2. A candle-writer aggregates ticks into 1-minute OHLCV buckets.
3. The SSE hub fans ticks out to per-user, per-symbol browser subscriptions with slow-consumer protection.
4. A market-clock worker periodically emits phase transitions on the same bus.

This finishes Phase 4. Phases 5–10 (screener, backtest, orders, auth/DB, ops) remain pending after this batch.

---

## Architecture

```
                ┌──────────────────┐
                │   Yahoo Finance  │
                └────────┬─────────┘
                         │ HTTP poll (5s default)
                         ▼
                ┌──────────────────┐         bus.emit("tick", t)
                │  YahooPoller     │──────────────────────────────┐
                └──────────────────┘                              │
                                                                 │      ┌──────────────────┐
                                                                 ├─────►│  CandleWriter    │── in-memory 1m buckets
                ┌──────────────────┐                              │      └──────────────────┘
                │  Angel One WS    │         bus.emit("tick", t)  │
                │  (per user)      │──────────────────────────────┤      ┌──────────────────┐
                └──────────────────┘                              ├─────►│  SseHub          │── per-conn SSE fan-out
                                                                 │      │  (Redis subs)    │
                                                                 │      └──────────────────┘
                                                                 │
                ┌──────────────────┐         bus.emit("market:phase", p)
                │ MarketClock      │───────────────────────────────────► consumers (Phase 5+)
                │ Worker           │
                └──────────────────┘
```

Each consumer subscribes independently to the bus (Task 5). No direct coupling between producers and consumers — ScreenerRunner (Task 24) and future consumers plug in without touching these workers.

---

## Components

### Task 18 — `server/workers/yahoo-poller.ts`

- **Class** `YahooPoller` with `subscribe(symbols)`, `unsubscribe(symbols)`, `start()`, `stop()`.
- **Default behavior**: polls subscribed symbols every 5 s using `getQuote` (Task 12) + `normalize` (Task 16), emits each tick on the bus.
- **Dependency injection**: `batchFetch` override for tests; default uses sequential per-symbol `getQuote`.
- **Failure**: per-symbol errors logged with `log.warn` and skipped; full-batch errors logged and next tick retries.
- **Test** (`yahoo-poller.test.ts`): injects a counting `batchFetch`, asserts `calls >= 2` after ~175 ms with `intervalMs: 50`.

### Task 19 — `server/data/sources/angelone/ws.ts` + `server/workers/angelone-ws.ts`

- **`ws.ts`**: minimal `WsLike` interface (`on`, `send`, `close`) + `defaultWsFactory(url)` using `require("ws")` (lazy `require` so tests can swap). No Bun-native WebSocket to avoid coupling tests to Bun runtime.
- **`angelone-ws.ts`**: `AngelOneWorker` class managing a `Map<userId, UserState>` (session, tokens, socket, reconnectAttempts).
- **Lifecycle**: `manageUser(userId, session, tokens)` registers user; `start()` enables connections; `dropUser(userId)` closes + removes. `stop()` closes all.
- **Per-connection flow**:
  1. Open WS to `wss://smartapis.angelone.in/websocket`.
  2. On `open`: send auth handshake (action 1) + subscribe (action 15, mode 1, NSE tokenList).
  3. On `message`: parse, if `type === "sf"` → `normalize` + `bus.emit("tick", tick)`.
  4. On `close`: exponential backoff reconnect (500 ms × 2^n, cap 30 s).
- **`ws` dependency**: add `"ws": "^8.18.0"` to `package.json` dependencies.
- **Test** (`angelone-ws.test.ts`): uses `createSocket: () => makeFakeSocket()` that records `__push` for the test to inject messages; asserts `bus` receives a tick for the right symbol.

### Task 20 — `server/workers/candle-writer.ts`

- **Class** `CandleWriter` with `onTick(tick)`, `flush(symbol, tf)`, `start()`, `stop()`.
- **Buckets**: in-memory `Map<key, Bucket>` where key = `${symbol}:1m:${minuteKey(ts)}`.
- **Aggregation**: first tick of a minute opens bucket (open=close=high=low=price, volume=tick.volume); subsequent ticks update high/low/close, add to volume.
- **No Redis writes** in this task — `flush()` returns buckets and clears them; persistence wiring lands in Phase 9 (Task 30b schema + candle writer integration).
- **Test** (`candle-writer.test.ts`): 2 tests covering same-minute aggregation and minute-rollover bucket creation.

### Task 21 — `server/http/sse/hub.ts` (replace stub) + `server/http/sse/quotes.ts` (new) + `server/http/sse/hub.test.ts` (new)

- **`hub.ts`** replaces the stub:
  - `SseHub` class with `register(connId, userId, symbols, send, close)`, `unregister(connId)`, `broadcastTick(tick)`, `dropStaleConnections()`.
  - Subscribes to `bus.on("tick")` in constructor (single instance `sseHub` exported at module load).
  - Per-symbol subscription state: writes to Redis via `RedisKeys.sseSubsKey(symbol)` (sadd of connId) and `RedisKeys.sseConnKey(connId)` (hash with userId/symbols/lastWrite, 60 s expire).
  - Slow-consumer detection: per-connection `pending` counter; if `pending > 50`, send `dropped` event and unregister.
  - Heartbeat: 30 s of no writes → drop.
- **`quotes.ts`**: `defineEventHandler` for `GET /api/stream/quotes?symbols=RELIANCE,TCS`. Requires `event.context.userId` (set by Task 30 auth). Calls `rateLimit(userId, "sse:subs", 1)`. Sets SSE headers, opens a keep-alive stream, sends ticks filtered by the registered symbol list, sends 5 s heartbeat, cleans up on `req.on("close")`.
- **Test** (`hub.test.ts`, integration): connects to live Redis at `TEST_REDIS_URL ?? redis://localhost:6379`. Registers 2 connections for RELIANCE, emits a tick on the bus, asserts both connections received it. **Env-caveat**: will fail RED in this sandbox (no Redis). Acceptable per Task 7–10 precedent.

### Task 22 — `server/workers/market-clock.ts`

- **Class** `MarketClockWorker` wrapping `MarketClock` (Task 15).
- **start()**: subscribes to `MarketClock` phase events → `bus.emit("market:phase", { phase, ts })`. Calls `clock.start()`.
- **stop()**: unsubscribes and calls `clock.stop()`.
- **Holidays**: from `getConfig().nseHolidays`.
- **Test** (`market-clock.test.ts`): injects `tickMs: 10` and a mutable `getNow`; mutates the time across a phase boundary; asserts `bus` received a `"market:phase"` event with `phase: "OPEN"`. **Requires env vars** for `getConfig()` to succeed — set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_URL`, `ANGELONE_MASTER_KEY` in the test runner.

---

## Data flow

1. **Cold start**: orchestrator (Task 30) wires workers in this order: `SseHub` (registers bus.on("tick") in constructor), `CandleWriter.start()`, `YahooPoller.subscribe(NIFTY_50)` + `YahooPoller.start()`, `AngelOneWorker.start()` + `manageUser()` per active session, `MarketClockWorker.start()`.
2. **Tick ingest**: Yahoo poller emits → bus → CandleWriter (aggregates) + SseHub (fans out to subscribed browsers).
3. **WS re-auth**: AngelOneWs detects `invalid_token` → emits `user:angelone:ready` (per plan note: real impl would emit a separate auth_failed event; we follow brief verbatim).
4. **Market phase**: every minute, `MarketClockWorker` emits the new phase. Consumers (screener, orders) gate themselves on this in later phases.

---

## Error handling

| Component | Strategy |
|---|---|
| YahooPoller | Per-symbol `try/catch`; warn + skip. Batch-level `try/catch`; log + retry next tick. |
| AngelOneWs | `socket.on("error")` → warn. `socket.on("close")` → exponential backoff reconnect, capped at 30 s. `invalid_token` → emit `user:angelone:ready` for upstream re-login flow. |
| CandleWriter | No IO → no errors possible at the aggregation layer. (Persistence errors are Phase 9 concern.) |
| SseHub | `try { send } catch` → unregister + close. `pending > 50` → drop with `slow_consumer`. `lastWrite > 30 s` ago → drop with `heartbeat_timeout`. |
| MarketClockWorker | Inherits from `MarketClock` (no errors at worker level). |

---

## Testing strategy

- **Tasks 18, 20, 22**: dependency-injected `batchFetch` / `tickMs` / `getNow` keep tests network-free and time-independent. Test files use `bun:test`.
- **Task 19**: `WsFactory` injection (`createSocket` option) + a `makeFakeSocket()` helper in the test file that records messages and exposes `__push`.
- **Task 21**: integration test only (requires live Redis). Acceptable env-caveat; matches Task 7–10 pattern.
- **All tests**: run via `bun test server/<path>` from project root. Full suite baseline after this batch: **expected ~46 pass / 8 fail** (8 pre-existing env-caveat, 0 pure-logic regressions).

---

## Brief-defect policy

Apply the same "note + apply + continue" rule used for Tasks 11–17:

- If the plan's test code disagrees with the impl snippet (off-by-one, missing export, typo), fix the test (or impl) to align with the **more specific contract** and document the fix in the per-task report.
- Append any defect found to `docs/REMAINING-WORK.md`'s "Known Brief Defects" section.
- Likely watch-list:
  - Task 19: `require("ws")` (CJS) in a Bun project — may log a warning; works under Bun.
  - Task 21: `SseHub` constructor registers a bus listener as a side effect — unusual but matches the brief.
  - Task 22: `bus.on("market:phase", () => {})` placeholder is a no-op listener — kept verbatim per brief.

---

## Env-caveat expectations

| Task | Caveat | Mitigation |
|---|---|---|
| 18 | None | — |
| 19 | None (after `ws` is installed) | Run `bun install` before tests |
| 20 | None | — |
| 21 | Test requires live Redis at `TEST_REDIS_URL ?? redis://localhost:6379` | Document in REMAINING-WORK.md. Pass in any env with Redis. |
| 22 | Test calls `getConfig()` which requires 5 env vars | Use a `.env.test` with dummy values (URL `"https://x.supabase.co"`, key `"x".repeat(32)` for `ANGELONE_MASTER_KEY`, any URL for `UPSTASH_REDIS_URL`) |

---

## Order of operations

1. **Doc refresh first**: rewrite `docs/REMAINING-WORK.md` to mark Tasks 14–17 done, update baseline to 37/47, trim pending list to 22. Commit as `docs: refresh REMAINING-WORK.md — Tasks 14-17 done`.
2. **Task 18**: write test → fail → implement → pass → commit `feat(workers): yahoo poller with bus emission`.
3. **Task 19**: add `ws` dep → `bun install` → write test → fail → implement → pass → commit `feat(workers): angel one per-user ws with exp backoff and tick fan-out`.
4. **Task 20**: write test → fail → implement → pass → commit `feat(workers): candle writer with 1m rolling buckets`.
5. **Task 21**: replace `hub.ts` stub → add `quotes.ts` → add `hub.test.ts` → run integration test → commit `feat(sse): connection registry + fan-out + quotes handler`.
6. **Task 22**: add `.env.test` → write test → fail → implement → pass → commit `feat(workers): market clock worker emits bus.market:phase on change`.
7. **Final doc refresh**: update `docs/REMAINING-WORK.md` to mark Tasks 18–22 done, baseline to ~46/54. Commit as `docs: refresh REMAINING-WORK.md — Phase 4 complete`.

---

## Out of scope (explicit)

- Task 30 (orchestrator) — these workers are exported as classes with `start()`/`stop()`; the orchestrator that boots them all and runs `/health` is a separate concern.
- Screener runner (Task 24) — will subscribe to the same `bus.on("tick")` that Task 20/21 use, but doesn't exist yet.
- Redis persistence of candles — CandleWriter is in-memory only. Persistence lands when Task 30b introduces the Drizzle schema.
- Auth middleware (Task 30) — `quotes.ts` reads `event.context.userId`; the actual JWT verification is a separate task.

---

## Files touched (summary)

| File | Action | Task |
|---|---|---|
| `docs/REMAINING-WORK.md` | Replace | Doc refresh |
| `package.json` | Modify (add `"ws": "^8.18.0"`) | 19 |
| `.env.test` | Create (dummy Supabase/Redis) | 22 |
| `server/workers/yahoo-poller.ts` | Create | 18 |
| `server/workers/yahoo-poller.test.ts` | Create | 18 |
| `server/data/sources/angelone/ws.ts` | Create | 19 |
| `server/workers/angelone-ws.ts` | Create | 19 |
| `server/workers/angelone-ws.test.ts` | Create | 19 |
| `server/workers/candle-writer.ts` | Create | 20 |
| `server/workers/candle-writer.test.ts` | Create | 20 |
| `server/http/sse/hub.ts` | Replace stub | 21 |
| `server/http/sse/quotes.ts` | Create | 21 |
| `server/http/sse/hub.test.ts` | Create | 21 |
| `server/workers/market-clock.ts` | Create | 22 |
| `server/workers/market-clock.test.ts` | Create | 22 |

**Total**: 1 replace (doc), 1 modify (package.json), 1 create (.env.test), 12 creates, 5 commits.
