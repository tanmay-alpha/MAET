# Phase 4 Live Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the live-ticks hot path: YahooPoller and AngelOneWs produce ticks on the internal bus; CandleWriter aggregates them into 1-minute OHLCV buckets; SseHub fans them out to per-user, per-symbol browser SSE connections with slow-consumer protection; MarketClockWorker emits phase transitions on the same bus.

**Architecture:** Two tick producers (YahooPoller HTTP poll every 5 s; AngelOneWs per-user WebSocket with exp-backoff reconnect) push ticks onto a typed EventEmitter (`bus`, Task 5). Three independent consumers subscribe: CandleWriter (in-memory aggregation), SseHub (per-connection SSE fan-out + Redis symbol subscription state), and future consumers (ScreenerRunner in Task 24). MarketClockWorker emits `market:phase` events on the same bus. Decoupling via bus means no consumer knows about any producer.

**Tech Stack:** Bun test runner, TypeScript strict, ioredis (already installed), `ws` (new — for Angel One WS), Node `crypto`, pino logger, h3 for SSE handler, Zod schemas from `@shared/types`.

**Spec:** `docs/superpowers/specs/2026-06-20-phase4-live-data-design.md`
**Master plan:** `docs/superpowers/plans/2026-06-19-stock-market-backend.md` (contains the verbatim briefs for Tasks 18–22 at lines 2802–3656)

---

## Global Constraints

This plan inherits all constraints from the master plan's "Global Constraints" section. Specifically:

- One-way imports: `http → domain → data`. Workers may import `domain/`, `infra/`, `data/`, `shared/` but never `http/`.
- All env vars (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, UPSTASH_REDIS_URL, ANGELONE_MASTER_KEY) are read via `getConfig()` from `server/config.ts` — never `process.env` at call sites.
- Every Redis key has a TTL (per `RedisKeys.*` builders).
- Tests run via `bun test` from project root: `bun test server/<path>/<file>.test.ts`.
- Commit after every task. Conventional Commits prefix: `feat(workers): …`, `feat(sse): …`, `docs: …`, `fix(infra): …`.
- Hot path (tick fan-out) must never write to Postgres.
- Per-task reports go to `.git/sdd/task-NN-report.md`. Per-task briefs already exist for Tasks 18–22 in the master plan; do NOT regenerate them.

---

## Task 0: Refresh REMAINING-WORK.md to reflect Tasks 14–17 done

**Files:**
- Modify: `docs/REMAINING-WORK.md` (replace stale "26 pending / 21 pass / 28 total" content)

**Context:** The doc was last updated 2026-06-19 (commit `8b8122f`) and predates Task 14's resolution. Tasks 14, 15, 16, 17 are all implemented and committed (`fd70d05`, `db2ded4`, `0a879eb`, `19028f1`). The actual baseline is **37 pass / 47 total** across 17 files (8 env-caveat failures, 0 pure-logic regressions).

- [ ] **Step 1: Rewrite REMAINING-WORK.md**

Replace the entire file with content matching the actual state. The new file must contain:

1. Header `> Last updated: 2026-06-20` and a note that Tasks 14–17 are done.
2. At a Glance table:
   - ✅ Completed: **17** (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
   - 🔧 In progress: **0**
   - ⏳ Pending: **22** (Tasks 18 → 30i + Final Review, less the 5 we're doing in this batch = 17)
   - **Total: 39**
3. Test baseline: `37 pass / 47 total (8 env-caveat failures from missing SUPABASE_URL/UPSTASH_REDIS_URL/ANGELONE_MASTER_KEY, no pure-logic regressions)`.
4. Delete the entire "In-Progress Task" section (Task 14 is done).
5. Update the "Pending Tasks" section to remove Tasks 14, 15, 16, 17. Update Phase 3 (Market Domain): remove 14, 15, 16 from the table — keep only 30c. Update Phase 4 (Live Data Pipeline): remove 18, 19, 20, 21, 22 from the table — keep only 30d. Update Phase 5 (Real-time Streaming): remove 21.
6. Update "Known Brief Defects" — keep all 5 prior defects, add Task 15 (2 defects) and Task 14 (already noted).
7. Update "Resume Point" to point at Task 18 next.
8. Update "Commits So Far" to include `fd70d05`, `db2ded4`, `0a879eb`, `19028f1`.

- [ ] **Step 2: Verify doc is consistent**

Run: `cd "/c/Users/TANMAY/OneDrive/Desktop/MAET" && grep -c "fd70d05\|db2ded4\|0a879eb\|19028f1" docs/REMAINING-WORK.md`
Expected: `4` (each commit hash appears once).

- [ ] **Step 3: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add docs/REMAINING-WORK.md
git commit -m "docs: refresh REMAINING-WORK.md — Tasks 14-17 done"
```

---

## Task 18: Yahoo poller worker

**Files:**
- Create: `server/workers/yahoo-poller.ts`
- Create: `server/workers/yahoo-poller.test.ts`

**Brief source:** Master plan lines 2802–2946 contain the verbatim TDD brief. **Read it before implementing.** The brief provides the test code, the impl code, and the commit message — copy them verbatim.

**Interfaces:**
- Consumes: `bus` from `server/infra/bus.ts` (Task 5), `getQuote` from `server/data/sources/yahoo.ts` (Task 12), `normalize` from `server/domain/market/tick.ts` (Task 16), `getLogger` from `server/infra/logger.ts` (Task 6)
- Produces: `YahooPoller` class (constructor `YahooPollerOptions { intervalMs?: number; batchFetch?: (symbols: string[]) => Promise<Tick[]> }`, methods `subscribe(symbols: string[])`, `unsubscribe(symbols: string[])`, `start()`, `stop()`)

- [ ] **Step 1: Write the failing test**

Create `server/workers/yahoo-poller.test.ts` with the exact test code from master plan lines 2814–2849 (the `describe("YahooPoller")` block).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/yahoo-poller.test.ts
```
Expected: FAIL with `Cannot find module './yahoo-poller'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/yahoo-poller.ts` with the exact code from master plan lines 2862–2930.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/yahoo-poller.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add server/workers/yahoo-poller.ts server/workers/yahoo-poller.test.ts
git commit -m "feat(workers): yahoo poller with bus emission"
```

- [ ] **Step 6: Write per-task report**

Create `.git/sdd/task-18-report.md` using the template from Task 14's report (`.git/sdd/task-14-report.md`): Status, What was implemented, Test results, Files Changed, Self-review (checklist), Commit hash. Mark "no brief defects" if applicable.

---

## Task 19: Per-user Angel One WS worker

**Files:**
- Modify: `package.json` (add `"ws": "^8"` to `dependencies`)
- Create: `server/data/sources/angelone/ws.ts`
- Create: `server/workers/angelone-ws.ts`
- Create: `server/workers/angelone-ws.test.ts`

**Brief source:** Master plan lines 2948–3179 contain the verbatim TDD brief.

**Interfaces:**
- Consumes: `bus` from `server/infra/bus.ts`, `login` from `server/data/sources/angelone/client.ts` (Task 17), `normalize` from `server/domain/market/tick.ts`, `getRedis` from `server/data/redis/client.ts`, `RedisKeys.angeloneSubsKey` from `server/data/redis/keys.ts`
- Produces: `WsLike` interface and `defaultWsFactory(url)` in `ws.ts`; `AngelOneWorker` class with `manageUser(userId, session, tokens)`, `dropUser(userId)`, `start()`, `stop()` in `angelone-ws.ts`

- [ ] **Step 1: Add `ws` dependency**

Edit `package.json`: add `"ws": "^8"` to the `dependencies` block. Run:

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun install
```
Expected: `ws` package installed; `node_modules/ws/package.json` exists.

- [ ] **Step 2: Write the failing test**

Create `server/workers/angelone-ws.test.ts` with the exact test code from master plan lines 2961–3019. The `makeFakeSocket()` helper at the bottom of the brief is part of the test file.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/angelone-ws.test.ts
```
Expected: FAIL with `Cannot find module './angelone-ws'`.

- [ ] **Step 4: Write `ws.ts` (WsLike abstraction)**

Create `server/data/sources/angelone/ws.ts` with the exact code from master plan lines 3031–3049.

- [ ] **Step 5: Write `angelone-ws.ts` (worker)**

Create `server/workers/angelone-ws.ts` with the exact code from master plan lines 3051–3165.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/angelone-ws.test.ts
```
Expected: PASS (1 test, at least 1 tick received on bus).

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add package.json bun.lock server/data/sources/angelone/ws.ts server/workers/angelone-ws.ts server/workers/angelone-ws.test.ts
git commit -m "feat(workers): angel one per-user ws with exp backoff and tick fan-out"
```

- [ ] **Step 8: Write per-task report**

Create `.git/sdd/task-19-report.md` mirroring Task 14/15 report structure. Note in the Concerns section that `require("ws")` is CJS in a Bun project (works, may warn — not a blocker).

---

## Task 20: Candle writer worker

**Files:**
- Create: `server/workers/candle-writer.ts`
- Create: `server/workers/candle-writer.test.ts`

**Brief source:** Master plan lines 3183–3321 contain the verbatim TDD brief.

**Interfaces:**
- Consumes: `bus` from `server/infra/bus.ts`, `Tick` and `Candle` types from `@shared/types`
- Produces: `CandleWriter` class with `onTick(tick: Tick): void`, `flush(symbol: string, tf: "1m" | "1d"): Candle[]`, `start(): void`, `stop(): void`. Maintains a private `Map<string, Bucket>` keyed by `${symbol}:1m:${minuteKey}`.

- [ ] **Step 1: Write the failing test**

Create `server/workers/candle-writer.test.ts` with the exact test code from master plan lines 3195–3229 (2 tests: same-minute aggregation, minute-rollover).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/candle-writer.test.ts
```
Expected: FAIL with `Cannot find module './candle-writer'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/workers/candle-writer.ts` with the exact code from master plan lines 3240–3306.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/candle-writer.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add server/workers/candle-writer.ts server/workers/candle-writer.test.ts
git commit -m "feat(workers): candle writer with 1m rolling buckets"
```

- [ ] **Step 6: Write per-task report**

Create `.git/sdd/task-20-report.md`. Status: DONE. Note: in-memory only — Redis persistence is Phase 9 (Task 30b) concern.

---

## Task 21: SSE connection registry and fan-out

**Files:**
- Modify: `server/http/sse/hub.ts` (replace stub from Task 4)
- Create: `server/http/sse/quotes.ts`
- Create: `server/http/sse/hub.test.ts`

**Brief source:** Master plan lines 3324–3536 contain the verbatim TDD brief.

**Interfaces:**
- Consumes: `bus` from `server/infra/bus.ts`, `getRedis` from `server/data/redis/client.ts`, `RedisKeys.sseConnKey` and `RedisKeys.sseSubsKey` from `server/data/redis/keys.ts`, `rateLimit` from `server/infra/rate-limit.ts` (uses `sse:subs` bucket from Task 8), `Tick` type from `@shared/types`, `AppError` from `@shared/types`
- Produces: `SseHub` class with `register(connId, userId, symbols, send, close)`, `unregister(connId)`, `broadcastTick(tick)`, `dropStaleConnections()`; module-level `sseHub` singleton; `quotesHandler` (default export) for `GET /api/stream/quotes`

**Env-caveat:** The integration test requires a live Redis at `TEST_REDIS_URL ?? redis://localhost:6379`. In this sandbox it will FAIL RED — acceptable per the same env-caveat pattern as Tasks 7–10.

- [ ] **Step 1: Write the failing test**

Create `server/http/sse/hub.test.ts` with the exact code from master plan lines 3337–3374. The test imports `Redis from "ioredis"` and calls `r.keys("sse:*")` in `afterAll` for cleanup.

- [ ] **Step 2: Run test to verify it fails (env-caveat)**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/http/sse/hub.test.ts
```
Expected: FAIL with Redis connection error or "Reached the max retries per request limit" (no Redis in sandbox). This is the expected env-caveat. **Do not fix this in this task** — it will pass in any env with reachable Redis.

- [ ] **Step 3: Replace `hub.ts` stub with full implementation**

Replace the entire contents of `server/http/sse/hub.ts` with the code from master plan lines 3386–3475 (the `SseHub` class + module-level `export const sseHub = new SseHub()`).

- [ ] **Step 4: Create `quotes.ts` SSE handler**

Create `server/http/sse/quotes.ts` with the exact code from master plan lines 3477–3520.

- [ ] **Step 5: Verify the file structure**

Run: `ls -la server/http/sse/`
Expected: `hub.ts`, `hub.test.ts`, `quotes.ts` all present.

- [ ] **Step 6: Commit (the env-caveat failure is expected and documented)**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add server/http/sse/hub.ts server/http/sse/quotes.ts server/http/sse/hub.test.ts
git commit -m "feat(sse): connection registry + fan-out + quotes handler"
```

- [ ] **Step 7: Write per-task report**

Create `.git/sdd/task-21-report.md`. Status: DONE (env-caveat). Note in the report: "test fails RED in this sandbox due to no Redis; will pass in any env with `TEST_REDIS_URL` reachable. Implementation matches brief verbatim."

---

## Task 22: Market clock worker emitting phase changes

**Files:**
- Create: `.env.test` (dummy env vars for `getConfig()`)
- Create: `server/workers/market-clock.ts`
- Create: `server/workers/market-clock.test.ts`

**Brief source:** Master plan lines 3539–3656 contain the verbatim TDD brief.

**Interfaces:**
- Consumes: `MarketClock` class and `computePhase` from `server/domain/market/clock.ts` (Task 15), `bus` from `server/infra/bus.ts`, `getLogger` from `server/infra/logger.ts`, `getConfig` from `server/config.ts` (for `nseHolidays`)
- Produces: `MarketClockWorker` class with `start()`, `stop()`, `onPhase(cb)` (re-exports `computePhase` for downstream use)

**Env-caveat:** The test calls `getConfig()` which requires 5 env vars. We pre-create `.env.test` to satisfy these, with dummy values.

- [ ] **Step 1: Create `.env.test`**

Create `.env.test` at project root:

```
SUPABASE_URL=https://x.supabase.co
SUPABASE_ANON_KEY=test-anon-key
SUPABASE_SERVICE_ROLE_KEY=test-service-key
UPSTASH_REDIS_URL=redis://localhost:6379
ANGELONE_MASTER_KEY=test_master_key_at_least_32_chars_long_xx
NODE_ENV=test
```

Add `.env.test` to `.gitignore` if not already present (it should be — verify by running `cat .gitignore`; `.env*` should be ignored; if not, add `.env.test` explicitly).

- [ ] **Step 2: Write the failing test**

Create `server/workers/market-clock.test.ts` with the exact code from master plan lines 3551–3577.

- [ ] **Step 3: Run test to verify it fails (with env loaded)**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/market-clock.test.ts
```
Expected: FAIL with `Cannot find module './market-clock'` (env vars are loaded from `.env.test` by Bun's auto-loading, so `getConfig()` will succeed and the test will reach the module-not-found error).

- [ ] **Step 4: Write minimal implementation**

Create `server/workers/market-clock.ts` with the exact code from master plan lines 3589–3640 (the `MarketClockWorker` class and `export { computePhase }` re-export).

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test server/workers/market-clock.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add server/workers/market-clock.ts server/workers/market-clock.test.ts
git commit -m "feat(workers): market clock worker emits bus.market:phase on change"
```

- [ ] **Step 7: Write per-task report**

Create `.git/sdd/task-22-report.md`. Status: DONE. Note: `bus.on("market:phase", () => {})` placeholder in `start()` is a no-op listener — kept verbatim per brief, may be cleaned up in a future task.

---

## Task 23: Final doc refresh and full suite verification

**Files:**
- Modify: `docs/REMAINING-WORK.md` (final refresh)

- [ ] **Step 1: Run full test suite**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
bun test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -5
```
Expected: ~46 pass / 8 fail (or close — exact count depends on whether Task 21's integration test counts as fail or error in bun's tally).

- [ ] **Step 2: Update REMAINING-WORK.md**

Edit `docs/REMAINING-WORK.md`:

1. Header `> Last updated: 2026-06-20` (already current).
2. At a Glance: ✅ Completed **22** (1–22); ⏳ Pending **17** (Tasks 23 → 30i + Final Review).
3. Test baseline: actual numbers from Step 1.
4. Pending Tasks section: Phase 5 (Screener) starts at Task 23. Phase 4 is empty.
5. Commits So Far: add all 5 new commit hashes from this batch.
6. Resume Point: Task 23 next (Screener DSL).

- [ ] **Step 3: Commit**

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add docs/REMAINING-WORK.md
git commit -m "docs: refresh REMAINING-WORK.md — Phase 4 complete"
```

- [ ] **Step 4: Update master progress log**

Edit `.git/sdd/progress.md` to append entries for Tasks 18, 19, 20, 21, 22. Use the format from existing entries (Task 14, 15, 16, 17 entries). For each: commit range, review status, test counts, brief defects (if any).

```bash
cd "/c/Users/TANMAY/OneDrive/Desktop/MAET"
git add .git/sdd/progress.md
git commit -m "docs(sdd): log Tasks 18-22 progress"
```

---

## Brief-defect watch-list (apply "note + apply + continue" rule)

If you encounter any of these during implementation, fix inline and append to `Known Brief Defects`:

- **Task 19**: `require("ws")` in a Bun project — works, may emit a CJS warning. Not a defect; note in report.
- **Task 21**: `SseHub` constructor registers `bus.on("tick")` as a side effect — unusual but matches brief. Not a defect.
- **Task 22**: `bus.on("market:phase", () => {})` placeholder is a no-op listener. Not a defect; kept verbatim per brief.

If you encounter a defect NOT on this watch-list (test code disagrees with impl code, missing export, off-by-one in magic numbers, etc.), apply the standard fix:
- The test is the contract for downstream consumers → align impl to test
- Update the brief file in the master plan if it's the source of the inconsistency
- Note in the per-task report and in REMAINING-WORK.md's Known Brief Defects section

---

## Out of scope

- Task 30 orchestrator (boots all workers, runs `/health` smoke test) — separate plan.
- Screener DSL/runner (Task 23+) — Phase 5.
- Redis persistence of candles from CandleWriter — Phase 9 (Task 30b schema).
- JWT auth middleware (Task 30) — `quotes.ts` reads `event.context.userId` set elsewhere.

---

## Self-review checklist

Before marking this plan complete, the implementer should verify:

- [ ] All 5 task commits exist on `main`: `feat(workers): yahoo poller...`, `feat(workers): angel one per-user ws...`, `feat(workers): candle writer...`, `feat(sse): connection registry...`, `feat(workers): market clock worker...`
- [ ] All 5 per-task reports exist: `.git/sdd/task-18-report.md` through `task-22-report.md`
- [ ] Two doc-refresh commits exist: pre-batch and post-batch
- [ ] Full test suite shows the expected baseline (~46 pass / 8 fail env-caveat, 0 pure-logic regressions)
- [ ] `package.json` has `"ws": "^8"` added
- [ ] `.env.test` exists and satisfies Task 22's `getConfig()` call
- [ ] REMAINING-WORK.md final state: 22 done, 17 pending, test baseline updated, Resume Point = Task 23