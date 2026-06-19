# Remaining Work — Stock Market Backend

> **Last updated:** 2026-06-19
> **Project:** India stock-market backend (NSE/BSE + Angel One + Yahoo)
> **Plan:** `docs/superpowers/plans/2026-06-19-stock-market-backend.md`
> **Progress log:** `.git/sdd/progress.md`
> **Per-task reports:** `.git/sdd/task-NN-report.md`

---

## At a Glance

| Status | Count | Tasks |
|---|---|---|
| ✅ Completed | **13** | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 |
| 🔧 In progress | **1** | 14 (brief defect) |
| ⏳ Pending | **26** | 15 → 30i + Final Review |
| **Total** | **40** | 39 plan tasks + Final Review |

**Test baseline:** 21 pass / 28 total (7 pre-existing Redis-integration env-caveat failures, no pure-logic regressions).

---

## In-Progress Task

### 🔧 Task 14 — Candle normalization and gap filling
- **Files:** `server/domain/market/candle.ts`, `server/domain/market/candle.test.ts`
- **State:** Implementation created; 1/2 tests pass; 1 brief defect blocks GREEN.
- **Brief defect:** The brief's test expects `expect(adj.volume).toBe` for a 2:1 split on volume=1000. The brief's own `adjustForCorporateAction` formula `Math.round(candle.volume * factor)` with `factor=2` gives **2000**, which is the correct answer (a 2:1 split doubles share count, not quadruples). The test's expected value is wrong.
- **Resolution:** Change test expectation from 4000 → 2000, commit, advance to review.

---

## Pending Tasks (26 remaining)

### Phase 3: Market Domain (3 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 15 | Market clock with NSE hours and holidays | `server/domain/market/clock.ts` + test | Phase computation: pre-open / open / closed / holiday |
| 16 | Tick normalization and staleness domain | `server/domain/market/tick.ts` + test | Pure: normalize raw ticks, mark stale (>N seconds old) |
| 30c | NSE holiday weekly refresh worker | `server/workers/nse-holiday-refresh.ts` | Cron job, fetches from NSE source, writes to Redis |

### Phase 4: Live Data Pipeline (6 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 17 | Angel One REST login client | `server/sources/angel-one/auth.ts` + test | `login()`, `profile()`, `totp()`, uses Task 9 encryption |
| 18 | Yahoo poller worker | `server/workers/yahoo-poller.ts` | Periodic poll, 60s for 1m, emits to bus |
| 19 | Per-user Angel One WS worker | `server/workers/angel-one-ws.ts` | One WS per active user, reconnects with backoff |
| 20 | Candle writer worker | `server/workers/candle-writer.ts` | Subscribes to tick bus, writes 1m candles to Redis |
| 22 | Market clock worker emitting phase changes | `server/workers/market-clock.ts` | Emits `market.phase.changed` every minute |
| 30d | Angel One session lifecycle module | `server/sources/angel-one/session.ts` | Token refresh, expiry, multi-user |

### Phase 5: Real-time Streaming (1 task)
| # | Task | Files | Notes |
|---|---|---|---|
| 21 | SSE connection registry and fan-out | `server/realtime/sse-hub.ts` + `server/api/stream/quotes.get.ts` | Per-user channel, backpressure |

### Phase 6: Screener (3 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 23 | Screener criteria DSL and evaluation engine | `server/domain/screener/dsl.ts` + engine + test | Pure: parse + evaluate against quote snapshots |
| 24 | Screener runner worker | `server/workers/screener-runner.ts` | Polls, runs criteria, emits results |
| 25 | Screener SSE stream and tRPC router | `server/realtime/screener-stream.ts` + tRPC router | Authenticated, per-user criteria sets |

### Phase 7: Backtest (2 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 26 | Backtest strategies (SMA cross, RSI) | `server/domain/backtest/strategies/` + test | Pure: take candles, emit signals |
| 27 | Backtest engine, tRPC router, persistence | `server/domain/backtest/engine.ts` + tRPC + DB | Run strategies, persist results |

### Phase 8: Orders & Portfolio (3 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 28 | Order validator, state machine, paper broker | `server/domain/orders/validator.ts` + state machine + paper broker + test | State transitions: NEW → VALIDATED → PLACED → FILLED |
| 29 | Orders and portfolio tRPC routers + idempotency + DB persistence | `server/api/trpc/routers/orders.ts` + portfolio + DB writes | Uses Task 10 withIdempotency |
| 30h | Margin / F&O exclusion guard | `server/domain/orders/fno-guard.ts` + test | Reject F&O / currency-derivatives symbols (regulatory) |

### Phase 9: Auth & DB (4 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 30 | Supabase Auth JWT verifier | `server/api/trpc/auth.ts` + `authedProcedure` | Verify JWT, extract userId |
| 30b | Drizzle schema and migrations (9 tables) | `server/db/schema.ts` + migrations | users, brokers, orders, fills, candles, screener_runs, backtest_runs, watchlist, idempotency |
| 30e | tRPC idempotency middleware wrapper | `server/api/trpc/idempotency.ts` | Wraps procedures with Task 10's withIdempotency |
| 30f | Graceful shutdown helper | `server/infra/shutdown.ts` | SIGTERM handler, drains workers, closes Redis |

### Phase 10: Operations (3 tasks)
| # | Task | Files | Notes |
|---|---|---|---|
| 30g | Health checks for all upstream dependencies | `server/api/health.get.ts` (replace stub from Task 4) | yahoo, angel-one, nse, market-clock, db, redis |
| 30i | Playwright e2e suite (6 journeys) | `tests/e2e/*.spec.ts` | login, screener, backtest, place-order, portfolio, sse-stream |
| 30 | Worker orchestrator + end-to-end smoke test | `server/orchestrator.ts` + smoke test | Boots all workers, runs /health, exits 0 |

### Final
| # | Task | Notes |
|---|---|---|
| Final | Whole-branch review | Adversarial review across all 40 tasks before merge |

---

## Known Brief Defects (encountered so far)

1. **Task 11** — JSON literal had 49 entries but test required ≥ 50. Implementer added ADANIENT.
2. **Task 12** — `FAIL_THRESHOLD = 10` but test expected circuit open at 3. Implementer lowered to 3.
3. **Task 12** — `export {...} from` was type-only but file used values. Implementer added value import.
4. **Task 13** — `nse.ts` snippet omits re-export of `UpstreamDegradedError` but test imports it. Implementer added.
5. **Task 14** — Test expects `expect(adj.volume).toBe` but correct math gives 2000. **FIX PENDING**.

**Pattern:** ~20% of briefs have small inconsistencies (missing re-exports, off-by-one in magic numbers, test-implementation mismatches). Implementer has been calling these out and applying minimal fixes.

## Tooling Issues (resolved)

- **Brief race condition** (Task 10): the brief-extraction script could produce a 0-byte file if read immediately. Mitigated by re-running the script and verifying `wc -l > 0` before dispatching. No further occurrences.
- **Tool truncation** (Task 14): Write/Edit operations that contain `expect(adj.volume).toBe` have been truncating the `4000` token. Workaround: use `bash` heredoc or `perl -i -pe` for surgical edits.

## File Layout (so far)

```
server/
  app.ts                              # Nitro app
  data/
    redis/
      client.ts                       # Task 7: ioredis + setnxWithTtl
      keys.ts                         # Task 7: RedisKeys.idempotencyKey
    sources/
      yahoo.ts                        # Task 12: Yahoo with retry/circuit
      nse.ts                          # Task 13: NSE scraper
  domain/
    market/
      symbol.ts                       # Task 11: SYMBOLS, lookupSymbol, yahooTicker
  infra/
    bus.ts                            # Task 5: EventEmitter
    config.ts                         # Task 2: Zod env
    encryption.ts                     # Task 9: AES-256-GCM
    health.ts                         # Task 4: stub
    idempotency.ts                    # Task 10: withIdempotency(userId, key, fn)
    logger.ts                         # Task 6: pino
    rate-limit.ts                     # Task 8: per-user limiter
shared/
  symbols/
    nifty50.json                      # Task 11: 50 NSE symbols
  types/
    ...                               # Task 3: Zod schemas + TS types
```

## Resume Point

1. **First:** finish Task 14. Fix the brief's volume expectation (4000 → 2000) using `bash` heredoc (Write/Edit are truncating the value). Run tests. Commit. Advance to review.
2. **Then:** Task 15 (market clock) — pure domain, no external services, no network.
3. **Then:** proceed in plan order through Task 30 + 30a–30i.
4. **Finally:** Final whole-branch review.

## Commits So Far

```
02e5e73 fix(infra): replace idempotency with brief's 3-arg (userId, key, fn) signature
6f6757f feat(market): symbol universe bundle + lookup/yahooTicker helpers
723c937 feat(sources): yahoo finance with retry + circuit breaker
17a2141 feat(sources): nse scraper for fundamentals + corporate actions
... (Tasks 1–9)
```
