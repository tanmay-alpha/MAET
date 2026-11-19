import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { inArray, eq } from "drizzle-orm";
import { db, getSqlClient } from "../../data/drizzle/client";
import {
  candles,
  companies,
  corporateActions,
  deadLetterQueue,
  fundamentals,
  ingestionRuns,
  quoteSnapshots,
} from "../../db/schema";
import { appRouter } from "../../api/trpc";
import { parseNseHolidays } from "../../config";
import { recentSessions } from "./evaluator";
import { buildDataQualityReport, getReliabilityReport, type ResolvedUniverse } from "./service";

const HOLIDAYS = parseNseHolidays(undefined);
// Friday 2026-11-06, 18:00 IST: the 2026-11-06 session has closed.
const NOW = new Date("2026-11-06T18:00:00+05:30");
const WINDOW = 10;
const SESSIONS = recentSessions("2026-11-06", WINDOW + 5, HOLIDAYS); // 5 sessions of history before the window
const WINDOW_SESSIONS = SESSIONS.slice(-WINDOW);

const SYMBOLS = {
  fresh: "TEST_DQ_FRESH",
  stale: "TEST_DQ_STALE",
  gappy: "TEST_DQ_GAPPY",
  bad: "TEST_DQ_BAD",
  empty: "TEST_DQ_EMPTY",
} as const;
const ALL = Object.values(SYMBOLS);
const SOURCE = "test_dq";

type Bar = { open: string; high: string; low: string; close: string; volume: number };
const GOOD: Bar = { open: "100", high: "105", low: "95", close: "102", volume: 1_000 };

function bar(symbol: string, date: string, overrides: Partial<Bar> = {}, ts = new Date(`${date}T09:15:00+05:30`)) {
  return { symbol, timeframe: "1d", ts, source: "yahoo", ...GOOD, ...overrides };
}

// candles CHECKs (0001_initial) reject non-positive prices and negative volume, so only
// range violations and zero volume can be stored; evaluator.test.ts covers the rest.
const BAD_BARS: Record<string, Partial<Bar>> = {
  [WINDOW_SESSIONS[9]!]: { high: "90", low: "95", open: "92", close: "93" }, // high < low
  [WINDOW_SESSIONS[8]!]: { open: "110" }, // open above high
  [WINDOW_SESSIONS[7]!]: { close: "90" }, // close below low
  [WINDOW_SESSIONS[5]!]: { volume: 0 }, // zero volume: warning only
};

async function cleanup() {
  await db.delete(candles).where(inArray(candles.symbol, ALL));
  await db.delete(quoteSnapshots).where(inArray(quoteSnapshots.companyId, ALL));
  await db.delete(fundamentals).where(inArray(fundamentals.companyId, ALL));
  await db.delete(corporateActions).where(inArray(corporateActions.symbol, ALL));
  await db.delete(companies).where(inArray(companies.id, ALL));
  await db.delete(ingestionRuns).where(eq(ingestionRuns.source, SOURCE));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.source, SOURCE));
  await getSqlClient()`DELETE FROM price_daily WHERE symbol = ANY(${ALL as unknown as string[]}::text[])`;
}

const universe: ResolvedUniverse = {
  id: "nifty50",
  label: "integration fixture",
  cap: 50,
  members: ALL.map((symbol) => ({ symbol, name: null })),
};

describe("data-quality report over seeded candles", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(companies).values(ALL.map((symbol) => ({ id: symbol, symbol, name: `${symbol} Ltd`, exchange: "NSE" })));
    await db.insert(candles).values([
      ...SESSIONS.map((date) => bar(SYMBOLS.fresh, date)),
      // Three sessions behind.
      ...SESSIONS.slice(0, -3).map((date) => bar(SYMBOLS.stale, date)),
      // Two holes inside the window; bars stamped at UTC midnight (05:30 IST, same IST date).
      ...SESSIONS.filter((date) => date !== WINDOW_SESSIONS[3] && date !== WINDOW_SESSIONS[4])
        .map((date) => bar(SYMBOLS.gappy, date, {}, new Date(`${date}T00:00:00Z`))),
      ...SESSIONS.map((date) => bar(SYMBOLS.bad, date, BAD_BARS[date])),
      // Intraday bars never count as daily coverage.
      { ...bar(SYMBOLS.empty, "2026-11-06"), timeframe: "5m" },
    ]);
    await db.insert(quoteSnapshots).values([
      { companyId: SYMBOLS.fresh, price: "102", asOf: new Date("2026-11-06T09:59:00Z"), source: "angelone" },
      { companyId: SYMBOLS.fresh, price: "101", asOf: new Date("2026-11-05T09:59:00Z"), source: "yahoo" },
      { companyId: SYMBOLS.stale, price: "50", asOf: new Date("2026-11-03T09:59:00Z"), source: "yahoo" },
    ]);
    await db.insert(fundamentals).values([
      { id: `${SYMBOLS.fresh}-2026Q2`, companyId: SYMBOLS.fresh, periodDate: new Date("2026-09-30T00:00:00Z"), periodType: "quarterly", filingDate: new Date("2026-10-20T00:00:00Z"), availableFrom: new Date("2026-10-21T00:00:00Z") },
      { id: `${SYMBOLS.fresh}-2026Q1`, companyId: SYMBOLS.fresh, periodDate: new Date("2026-06-30T00:00:00Z"), periodType: "quarterly" },
      // Daily market rows and observation-time ratio snapshots (Yahoo/NSE) are not reported periods.
      { id: `${SYMBOLS.fresh}-market-2026-11-06`, companyId: SYMBOLS.fresh, periodDate: new Date("2026-11-06T10:00:00Z"), periodType: "market" },
      { id: `${SYMBOLS.fresh}-snapshot-2026-11-07`, companyId: SYMBOLS.fresh, periodDate: new Date("2026-11-07T10:00:00Z"), periodType: "snapshot" },
    ]);
    await db.insert(corporateActions).values({ symbol: SYMBOLS.fresh, companyId: SYMBOLS.fresh, actionType: "DIVIDEND", exDate: new Date("2026-08-14T00:00:00+05:30") });
    await getSqlClient()`
      INSERT INTO price_daily (symbol, date, open, high, low, close, volume, source_tag)
      VALUES (${SYMBOLS.fresh}, '2026-11-09', 1, 2, 0.5, 1.5, 10, 'yahoo')
    `;
  });

  afterAll(cleanup);

  const report = () => buildDataQualityReport(universe, { now: NOW, holidays: HOLIDAYS, windowSessions: WINDOW });

  it("classifies freshness against the latest completed NSE session", async () => {
    const result = await report();
    expect(result.calendar).toMatchObject({ latestCompletedSession: "2026-11-06", windowSessions: WINDOW, windowStart: WINDOW_SESSIONS[0] });
    const bySymbol = Object.fromEntries(result.symbols.map((row) => [row.symbol, row]));
    expect(bySymbol[SYMBOLS.fresh]).toMatchObject({ freshness: "fresh", sessionsBehind: 0, latestCandleDate: "2026-11-06", missingSessions: 0, expectedSessions: WINDOW, candleSource: "yahoo" });
    expect(bySymbol[SYMBOLS.stale]).toMatchObject({ freshness: "stale", sessionsBehind: 3, missingSessions: 3 });
    expect(bySymbol[SYMBOLS.gappy]).toMatchObject({ freshness: "fresh", sessionsBehind: 0, missingSessions: 2, latestCandleDate: "2026-11-06" });
    expect(bySymbol[SYMBOLS.empty]).toMatchObject({ freshness: "missing", latestCandleDate: null, sessionsBehind: null, missingSessions: WINDOW });
    expect(bySymbol[SYMBOLS.fresh]!.name).toBe(`${SYMBOLS.fresh} Ltd`);
  });

  it("counts invalid and zero-volume bars in SQL and labels the newest samples", async () => {
    const result = await report();
    const bad = result.symbols.find((row) => row.symbol === SYMBOLS.bad)!;
    expect(bad.invalidBars).toBe(3);
    expect(bad.zeroVolumeBars).toBe(1);
    expect(bad.invalidSamples).toEqual([
      { date: WINDOW_SESSIONS[9]!, issues: ["high_below_low", "open_outside_range", "close_outside_range"] },
      { date: WINDOW_SESSIONS[8]!, issues: ["open_outside_range"] },
      { date: WINDOW_SESSIONS[7]!, issues: ["close_outside_range"] },
    ]);
    for (const symbol of [SYMBOLS.fresh, SYMBOLS.stale, SYMBOLS.gappy]) {
      expect(result.symbols.find((row) => row.symbol === symbol)!.invalidBars).toBe(0);
    }
  });

  it("attributes the newest quote, fundamentals period and corporate actions", async () => {
    const result = await report();
    const fresh = result.symbols.find((row) => row.symbol === SYMBOLS.fresh)!;
    expect(fresh).toMatchObject({ lastQuoteAt: "2026-11-06T09:59:00.000Z", quoteSource: "angelone", quoteDelayed: false });
    expect(fresh.fundamentals).toEqual({ latestPeriod: "2026-09-30", latestPeriodType: "quarterly", financialRows: 2, rowsMissingAvailability: 1 });
    expect(fresh.corporateActions).toEqual({ count: 1, latestExDate: "2026-08-14" });
    const stale = result.symbols.find((row) => row.symbol === SYMBOLS.stale)!;
    expect(stale).toMatchObject({ quoteSource: "yahoo", quoteDelayed: true });
    const empty = result.symbols.find((row) => row.symbol === SYMBOLS.empty)!;
    expect(empty).toMatchObject({ lastQuoteAt: null, quoteSource: null, quoteDelayed: null });

    expect(result.summary).toMatchObject({
      symbols: 5, withDailyCandles: 4, coveragePct: 80, fresh: 3, stale: 1, missing: 1,
      invalidBars: 3, symbolsWithInvalidBars: 1, zeroVolumeBars: 1, quotesCovered: 2,
      fundamentalsCovered: 1, fundamentalsMissingAvailability: 1, corporateActionsCovered: 1,
    });
    expect(result.summary.lastQuote).toEqual({ at: "2026-11-06T09:59:00.000Z", source: "angelone", delayed: false });
  });

  it("derives pipeline gaps from the tables instead of hardcoding them", async () => {
    const result = await report();
    const ids = result.pipelineGaps.map((gap) => gap.id);
    // price_daily has a bar (2026-11-09) newer than any candle the universe has.
    expect(result.pipelineGaps.find((gap) => gap.id === "price_daily_not_consumed")).toMatchObject({ severity: "critical" });
    expect(ids).toContain("fundamentals_missing_availability");
    expect(ids).not.toContain("corporate_actions_empty");
    expect(ids).not.toContain("quote_snapshots_empty");
    expect(ids).not.toContain("no_daily_candles");
    const [{ exists }] = await getSqlClient()<Array<{ exists: boolean }>>`SELECT EXISTS (SELECT 1 FROM universe_membership) AS exists`;
    expect(ids.includes("universe_membership_empty")).toBe(!exists);
  });
});

describe("dataQuality router", () => {
  it("serves the public report without a session", async () => {
    const caller = appRouter.createCaller({ email: null, role: "user" });
    const result = await caller.dataQuality.getPublicReport();
    expect(result.source).toBe("database");
    expect(result.universe).toMatchObject({ id: "nifty50", cap: 50 });
    expect(result.symbols.length).toBe(result.universe.symbolCount);
    expect(result.symbols.length).toBeLessThanOrEqual(50);
  });

  it("rejects unknown universes", async () => {
    const caller = appRouter.createCaller({ email: null, role: "user" });
    // @ts-expect-error invalid universe on purpose
    await expect(caller.dataQuality.getPublicReport({ universe: "everything" })).rejects.toThrow();
  });

  it("keeps reliability admin-only", async () => {
    const signedOut = appRouter.createCaller({ email: null, role: "user" });
    await expect(signedOut.dataQuality.getReliability()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    const user = appRouter.createCaller({ userId: "00000000-0000-4000-8000-000000000001", email: null, role: "user" });
    await expect(user.dataQuality.getReliability()).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });
});

describe("reliability report", () => {
  beforeAll(async () => {
    await db.delete(ingestionRuns).where(eq(ingestionRuns.source, SOURCE));
    await db.delete(deadLetterQueue).where(eq(deadLetterQueue.source, SOURCE));
    await db.insert(ingestionRuns).values([
      { batchId: "dq-1", source: SOURCE, dataType: "prices", operation: "upsert", status: "succeeded", startedAt: new Date("2026-11-05T13:00:00Z"), completedAt: new Date("2026-11-05T13:05:00Z") },
      { batchId: "dq-2", source: SOURCE, dataType: "prices", operation: "upsert", status: "failed", retryCount: 2, startedAt: new Date("2026-11-06T13:00:00Z") },
    ]);
    await db.insert(deadLetterQueue).values({ source: SOURCE, dataType: "prices", payload: {}, errorMessage: "boom", retryCount: 3 });
  });

  afterAll(async () => {
    await db.delete(ingestionRuns).where(eq(ingestionRuns.source, SOURCE));
    await db.delete(deadLetterQueue).where(eq(deadLetterQueue.source, SOURCE));
  });

  it("reports only recorded queue, ingestion and DLQ state", async () => {
    const report = await getReliabilityReport(NOW);
    if (!report.strategyJobs.available) throw new Error(report.strategyJobs.reason);
    expect(report.strategyJobs.queues.map((queue) => queue.kind)).toEqual(["backtest", "sweep", "walk-forward"]);
    expect(report.strategyJobs.queues[0]!.abandoned).not.toBeNull();
    expect(report.strategyJobs.queues[1]!.abandoned).toBeNull();

    if (!report.ingestion.available) throw new Error(report.ingestion.reason);
    expect(report.ingestion.workers.find((worker) => worker.source === SOURCE)).toEqual({
      source: SOURCE, dataType: "prices", runs: 2, failedRuns: 1, retries: 2, lastStatus: "failed",
      lastStartedAt: "2026-11-06T13:00:00.000Z", lastSucceededAt: "2026-11-05T13:05:00.000Z",
    });

    if (!report.deadLetterQueue.available) throw new Error(report.deadLetterQueue.reason);
    expect(report.deadLetterQueue.bySource[SOURCE]).toBe(1);
    expect(report.deadLetterQueue.pendingRetries).toBeGreaterThanOrEqual(3);
    expect(report.deadLetterQueue.oldestPendingAt).not.toBeNull();

    // Daily-processor completion is recorded only in Redis; without Redis it is unavailable, not "not run".
    if (!report.health.available) throw new Error(report.health.reason);
    expect(report.dailyProcessor.available).toBe(report.health.checks.redis);
  }, 15_000);
});
