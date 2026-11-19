import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { presetToV3Definition, type RiskConfig } from "../../domain/backtest/preset-to-v3-adapter";
import { runBacktestV3, type V3TradeRecord } from "../../domain/strategy/runner-v3";
import { getSqlClient } from "../../data/drizzle/client";
import { backtestV2Router } from "../../api/trpc/routers/backtest-v2";
import { MAX_STORED_BACKTEST_RUNS_PER_USER, MAX_STORED_EQUITY_POINTS } from "./run-store";

/** The Backtest Lab path: a V2 preset translated to a V3 AST and run by runner-v3. */
describe("Backtest Lab presets on the V3 engine", () => {
  const risk: RiskConfig = { initialCapital: 100_000, feeBps: 10, slippageBps: 5, positionSizePercent: 100, maximumOpenPositions: 1 };
  const candles: Candle[] = Array.from({ length: 200 }, (_, i) => {
    const p = 3000 + 80 * Math.sin(i / 8) + i;
    return { symbol: "TCS", tf: "1d", ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), open: p, high: p + 5, low: p - 5, close: p, volume: 10_000, source: "test" };
  });
  const run = (data: Candle[]) =>
    runBacktestV3({
      strategyVersionId: "preset",
      definition: presetToV3Definition({ type: "SMA_CROSS", fastPeriod: 10, slowPeriod: 20 }, risk),
      symbol: "TCS",
      candles: data,
    });

  it("trades the SMA cross preset and marks equity on every bar", () => {
    const result = run(candles);
    expect(result.tradeCount).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(candles.length);
    for (const t of result.trades) expect(t.entryBar).toBeGreaterThan(t.entrySignalBar);
  });

  it("decides earlier trades without seeing later bars", () => {
    const cutoff = 150;
    const altered = candles.map((c, i) => (i >= cutoff ? { ...c, open: c.open * 0.7, high: c.high * 0.7, low: c.low * 0.7, close: c.close * 0.7 } : c));
    const closedBefore = (trades: V3TradeRecord[]) => trades.filter((t) => t.exitBar < cutoff);
    expect(closedBefore(run(altered).trades)).toEqual(closedBefore(run(candles).trades));
  });
});

/** backtestV2.run against PostgreSQL: per-user retention and the stored curve size. */
describe("Backtest Lab run storage (PostgreSQL)", () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const bars = 1_600;

  it("keeps each user's newest runs, deletes the oldest in the run's transaction and stores a bounded curve", async () => {
    if (!databaseUrl) {
      console.log("  Skipping backtest run storage integration: TEST_DATABASE_URL not set");
      return;
    }
    const sql = getSqlClient();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const symbol = `BTRET${userA.slice(0, 6).toUpperCase()}`;
    const input = {
      symbol,
      timeframe: "1d" as const,
      strategy: { type: "SMA_CROSS" as const, fastPeriod: 10, slowPeriod: 30 },
    };

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${userA}), (${userB}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.users (id, email) VALUES (${userA}, ${`bt-a-${userA}@example.com`}), (${userB}, ${`bt-b-${userB}@example.com`})`;
      const candleRows = Array.from({ length: bars }, (_, i) => {
        const close = 1000 + 90 * Math.sin(i / 11) + i * 0.2;
        return {
          symbol,
          timeframe: "1d",
          ts: new Date(Date.UTC(2018, 0, 1) + i * 86_400_000).toISOString(),
          open: close.toFixed(4),
          high: (close + 4).toFixed(4),
          low: (close - 4).toFixed(4),
          close: close.toFixed(4),
          volume: 50_000,
          source: "test",
        };
      });
      await sql`INSERT INTO public.candles ${sql(candleRows)}`;

      // Existing history: A one row over the cap with distinct ages, B a few rows of its own.
      const seed = (userId: string, count: number) => sql`
        INSERT INTO public.backtest_runs (user_id, symbol, timeframe, strategy, parameters, result, created_at)
        SELECT ${userId}, ${symbol}, '1d', 'SMA_CROSS', jsonb_build_object('seeded', i), jsonb_build_object('seeded', i),
          '2026-01-01T00:00:00Z'::timestamptz + i * interval '1 minute'
        FROM generate_series(0, ${count - 1}::int) AS i`;
      await seed(userA, MAX_STORED_BACKTEST_RUNS_PER_USER + 1);
      await seed(userB, 3);

      const callerA = backtestV2Router.createCaller({ userId: userA, email: null, role: "user" });
      const res = await callerA.run(input);
      expect(res.result.equityCurve).toHaveLength(bars);

      const runsA = await sql<{ id: string; seeded: number | null; points: number | null }[]>`
        SELECT id, (result->>'seeded')::int AS seeded, jsonb_array_length(result->'equityCurve') AS points
        FROM public.backtest_runs WHERE user_id = ${userA} ORDER BY created_at DESC`;
      expect(runsA).toHaveLength(MAX_STORED_BACKTEST_RUNS_PER_USER);
      expect(runsA[0]!.id).toBe(res.runId);
      // The two oldest seeded rows (0 and 1) went; everything newer stayed.
      const keptSeeds = runsA.slice(1).map((row) => row.seeded).sort((a, b) => a! - b!);
      expect(keptSeeds).toEqual(Array.from({ length: MAX_STORED_BACKTEST_RUNS_PER_USER - 1 }, (_, i) => i + 2));
      const storedPoints = runsA[0]!.points!;
      expect(storedPoints).toBeGreaterThan(1);
      expect(storedPoints).toBeLessThanOrEqual(MAX_STORED_EQUITY_POINTS + 1);
      const [stored] = await sql<{ first: unknown; last: unknown }[]>`
        SELECT result->'equityCurve'->0 AS first, result->'equityCurve'->-1 AS last
        FROM public.backtest_runs WHERE id = ${res.runId}`;
      expect(stored!.first).toEqual(JSON.parse(JSON.stringify(res.result.equityCurve[0])));
      expect(stored!.last).toEqual(JSON.parse(JSON.stringify(res.result.equityCurve.at(-1))));

      const [{ count: countB }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM public.backtest_runs WHERE user_id = ${userB}`;
      expect(countB).toBe(3);

      // Concurrent runs serialise on the user's lock: the cap holds and every new run survives.
      const concurrent = await Promise.all(Array.from({ length: 4 }, () => callerA.run(input)));
      const after = await sql<{ id: string }[]>`SELECT id FROM public.backtest_runs WHERE user_id = ${userA}`;
      expect(after).toHaveLength(MAX_STORED_BACKTEST_RUNS_PER_USER);
      const afterIds = new Set(after.map((row) => row.id));
      for (const run of [res, ...concurrent]) expect(afterIds.has(run.runId)).toBe(true);
    } finally {
      await sql`DELETE FROM public.backtest_runs WHERE user_id IN (${userA}, ${userB})`;
      await sql`DELETE FROM public.candles WHERE symbol = ${symbol}`;
      await sql`DELETE FROM public.users WHERE id IN (${userA}, ${userB})`;
      await sql`DELETE FROM auth.users WHERE id IN (${userA}, ${userB})`;
    }
  }, 60_000);
});
