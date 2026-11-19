import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "../../domain/strategy/runner-v3";
import { computeLegCharges } from "../../domain/strategy/fee-model";
import { canonicalJson, candleFingerprint, serverGitCommit, sha256Hex } from "./hashing";
import { buildRunMetadata, parseRunMetadata } from "./run-metadata";
import {
  alignOnCommonDates,
  cagr,
  compareRuns,
  costDrag,
  dailyCloses,
  drawdownSeries,
  marketDateKey,
  maxDrawdown,
  rebase,
  sharpeRatio,
  turnover,
  type ComparisonInput,
} from "./comparison";
import { buildRunReport, effectiveCostAssumptions, equityCsv, runCsv, tradesCsv, type StoredRun, type StoredTrade } from "./report";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(n: number, symbol = "TESTSYM"): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 * (1 + 0.001 * i) + 8 * Math.sin(i / 7);
    return { symbol, tf: "1d", ts: new Date(START + i * DAY).toISOString(), open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 500_000, source: "test" };
  });
}

const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
function definition(execution: Partial<StrategyExecutionConfig>): StrategyDefinition {
  return {
    name: "cross",
    direction: "LONG_ONLY",
    entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }] },
    exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: "CROSS_BELOW", right: sma(20) }] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
    execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", initialCapital: 100_000, ...execution } as StrategyExecutionConfig,
  };
}

describe("hashing", () => {
  it("canonical JSON ignores key order at every depth but keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ a: 1, skipped: undefined })).toBe('{"a":1}');
  });

  it("canonical JSON refuses non-finite numbers instead of hashing them as null", () => {
    expect(() => canonicalJson({ sharpe: Number.NaN })).toThrow();
    expect(() => canonicalJson([Infinity])).toThrow();
  });

  it("candle fingerprint is the full SHA-256 whose prefix is the engine's data hash", () => {
    const bars = candles(120);
    const engine = runBacktestV3({ strategyVersionId: "v", definition: definition({}), symbol: "TESTSYM", candles: bars, timeframe: "1d" });
    const fingerprint = candleFingerprint(bars);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.slice(0, 16)).toBe(engine.dataHash);
    // Same bars in another order describe the same data; one changed close does not.
    expect(candleFingerprint([...bars].reverse())).toBe(fingerprint);
    const changed = bars.map((c, i) => (i === 60 ? { ...c, close: c.close + 0.01 } : c));
    expect(candleFingerprint(changed)).not.toBe(fingerprint);
  });

  it("server commit comes from GIT_SHA, then RENDER_GIT_COMMIT, else unknown", () => {
    expect(serverGitCommit({ GIT_SHA: "abc", RENDER_GIT_COMMIT: "def" } as NodeJS.ProcessEnv)).toBe("abc");
    expect(serverGitCommit({ RENDER_GIT_COMMIT: "def" } as NodeJS.ProcessEnv)).toBe("def");
    expect(serverGitCommit({} as NodeJS.ProcessEnv)).toBe("unknown");
  });

  it("run metadata records the bars used and round-trips through jsonb parsing", () => {
    const bars = candles(60);
    const meta = buildRunMetadata({
      symbols: ["TESTSYM"], candles: [...bars].reverse(), engineVersion: "4.0.0", indicatorVersion: "i1", feeModelVersion: "2.0.0",
      env: { RENDER_GIT_COMMIT: "deadbeef" } as NodeJS.ProcessEnv,
    });
    expect(meta).toMatchObject({ gitCommitSha: "deadbeef", candleCount: 60, firstCandleTs: bars[0].ts, lastCandleTs: bars[59].ts });
    expect(meta.candleFingerprint.value).toBe(candleFingerprint(bars));
    expect(parseRunMetadata(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
    expect(parseRunMetadata(null)).toBeNull();
    expect(parseRunMetadata({ schema: "something-else" })).toBeNull();
  });
});

describe("effective cost assumptions", () => {
  it("fills absent fields with the defaults the engine actually charges", () => {
    // The fee model applies these defaults; an explicit copy of them must cost exactly the same.
    for (const declared of [{}, { feeModel: "FIXED_BPS" as const }, { feeModel: "VOLUME_AWARE" as const, brokerage: 20 }]) {
      const raw = { initialCapital: 100_000, ...declared } as StrategyExecutionConfig;
      const effective = effectiveCostAssumptions(raw);
      const explicit = {
        ...raw,
        feeModel: effective.feeModel,
        feeBps: effective.feeBps ?? undefined,
        exchange: (effective.exchange ?? undefined) as "NSE" | undefined,
        product: (effective.product ?? undefined) as "DELIVERY" | undefined,
        brokerage: effective.brokerage ?? undefined,
      };
      for (const side of ["BUY", "SELL"] as const) {
        expect(computeLegCharges(explicit, side, 250_000)).toEqual(computeLegCharges(raw, side, 250_000));
      }
    }
  });

  it("an absent slippage behaves exactly like the stated default", () => {
    const bars = candles(200);
    const run = (execution: Partial<StrategyExecutionConfig>) =>
      runBacktestV3({ strategyVersionId: "v", definition: definition(execution), symbol: "TESTSYM", candles: bars, timeframe: "1d" });
    const implicit = run({});
    expect(implicit.trades.length).toBeGreaterThan(0);
    expect(run({ slippageBps: effectiveCostAssumptions({}).slippageBps }).equityCurve).toEqual(implicit.equityCurve);
    expect(run({ slippageBps: 25 }).equityCurve).not.toEqual(implicit.equityCurve);
  });
});

describe("comparison maths", () => {
  const dv = (date: string, value: number) => ({ date, value });

  it("keys timestamps by Indian market date", () => {
    // A daily bar stamped 00:00 IST is 18:30 UTC on the previous calendar day.
    expect(marketDateKey("2024-03-04T18:30:00.000Z")).toBe("2024-03-05");
    expect(marketDateKey("2024-03-05T09:59:00.000Z")).toBe("2024-03-05");
  });

  it("takes the last equity value of each market date", () => {
    const closes = dailyCloses([
      { timestamp: "2024-03-05T04:00:00.000Z", equity: 101 },
      { timestamp: "2024-03-05T09:00:00.000Z", equity: 103 },
      { timestamp: "2024-03-04T09:00:00.000Z", equity: 100 },
      { timestamp: "2024-03-06T09:00:00.000Z", equity: Number.NaN },
    ]);
    expect(closes).toEqual([dv("2024-03-04", 100), dv("2024-03-05", 103)]);
  });

  it("non-overlapping runs share no dates", () => {
    const aligned = alignOnCommonDates([[dv("2024-01-01", 1), dv("2024-01-02", 2)], [dv("2024-02-01", 1)]]);
    expect(aligned).toEqual({ dates: [], values: [[], []], excluded: [2, 1] });
  });

  it("a single-day overlap aligns on that one date", () => {
    const aligned = alignOnCommonDates([[dv("2024-01-01", 1), dv("2024-01-02", 2)], [dv("2024-01-02", 5), dv("2024-01-03", 6)]]);
    expect(aligned).toEqual({ dates: ["2024-01-02"], values: [[2], [5]], excluded: [1, 1] });
  });

  it("gaps in any run drop that date from every run", () => {
    const a = [dv("2024-01-01", 10), dv("2024-01-02", 11), dv("2024-01-03", 12), dv("2024-01-05", 14)];
    const b = [dv("2024-01-01", 20), dv("2024-01-03", 22), dv("2024-01-04", 23), dv("2024-01-05", 24)];
    const c = [dv("2024-01-05", 34), dv("2024-01-01", 30), dv("2024-01-03", 32)];
    const aligned = alignOnCommonDates([a, b, c]);
    expect(aligned.dates).toEqual(["2024-01-01", "2024-01-03", "2024-01-05"]);
    expect(aligned.values).toEqual([[10, 12, 14], [20, 22, 24], [30, 32, 34]]);
    expect(aligned.excluded).toEqual([1, 1, 0]);
  });

  it("rebases to 100 and refuses a non-positive start", () => {
    expect(rebase([200, 250, 180])).toEqual([100, 125, 90]);
    expect(rebase([])).toBeNull();
    expect(rebase([0, 5])).toBeNull();
  });

  it("drawdown runs from the running peak", () => {
    const drawdowns = drawdownSeries([100, 120, 90, 130, 117]);
    [0, 0, -0.25, 0, -0.1].forEach((expected, i) => expect(drawdowns[i]).toBeCloseTo(expected, 12));
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(0.25, 12);
    expect(maxDrawdown([100, 110, 120])).toBe(0);
    expect(maxDrawdown([])).toBe(0);
  });

  it("cost drag is fees plus slippage over capital", () => {
    expect(costDrag([{ fees: 30, slippage: 20 }, { fees: 25, slippage: 25 }], 10_000)).toBeCloseTo(0.01, 12);
    expect(costDrag([], 10_000)).toBe(0);
    expect(costDrag([{ fees: 1, slippage: 1 }], 0)).toBeNull();
  });

  it("turnover counts both legs of every trade against average equity", () => {
    const trade = { entryFillTs: null, entryPrice: 100, entryQuantity: 100, exitPrice: 110, exitQuantity: 100, fees: 0, slippage: 0 };
    // 10,000 in + 11,000 out over 10,500 average equity = 2.
    expect(turnover([trade], 10_500)).toBeCloseTo(2, 12);
    // An open trade has only its entry leg; short quantities count by size.
    expect(turnover([{ ...trade, entryQuantity: -100, exitPrice: null, exitQuantity: null }], 10_000)).toBeCloseTo(1, 12);
    expect(turnover([trade], 0)).toBeNull();
  });

  it("CAGR needs at least a day and a positive start", () => {
    expect(cagr(100, 121, "2024-01-01", "2025-12-31")).toBeCloseTo(1.21 ** (365.25 / 730) - 1, 12);
    expect(cagr(100, 120, "2024-01-01", "2024-01-01")).toBeNull();
    expect(cagr(0, 120, "2024-01-01", "2024-02-01")).toBeNull();
    expect(cagr(100, 0, "2024-01-01", "2024-02-01")).toBe(-1);
  });

  it("Sharpe annualises by the observed return frequency and needs two returns with variation", () => {
    const dates = Array.from({ length: 5 }, (_, i) => new Date(START + i * 7 * DAY).toISOString().slice(0, 10));
    const values = [100, 102, 101, 104, 103];
    const returns = values.slice(1).map((v, i) => v / values[i] - 1);
    const mean = returns.reduce((s, r) => s + r, 0) / 4;
    const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / 3);
    // Weekly points: 4 returns over 28 days.
    expect(sharpeRatio(values, dates)).toBeCloseTo((mean / std) * Math.sqrt(4 / (28 / 365.25)), 10);
    expect(sharpeRatio([100, 101], dates.slice(0, 2))).toBeNull();
    expect(sharpeRatio([100, 101, 102.01], dates.slice(0, 3))).toBeNull();
  });
});

describe("compareRuns", () => {
  const cost = effectiveCostAssumptions({});
  function run(jobId: string, start: number, values: number[], extra: Partial<ComparisonInput> = {}): ComparisonInput {
    return {
      jobId, label: jobId, symbolOrUniverse: "X", timeframe: "1d", engineVersion: "4.0.0", benchmarkSymbol: null, costAssumptions: cost,
      equity: values.map((equity, i) => ({ timestamp: new Date(START + (start + i) * DAY).toISOString(), equity })),
      trades: [],
      ...extra,
    };
  }

  it("computes every metric over the common window only", () => {
    // A doubles before B starts; inside the shared window both go 100 -> 110 -> 99 -> 121.
    const a = run("a", 0, [50, 70, 100, 100, 110, 99, 121]);
    const b = run("b", 3, [1000, 1100, 990, 1210, 2000]);
    const result = compareRuns([a, b]);
    expect(result.intersection).toMatchObject({ status: "OK", commonDates: 4, from: "2024-01-04", to: "2024-01-07" });
    expect(result.intersection.statement).toContain("2024-01-04 to 2024-01-07");
    for (const r of result.runs) {
      expect(r.series.map((p) => p.equity)).toEqual([100, 110, 99, 121].map((v) => expect.closeTo(v, 10)) as unknown as number[]);
      expect(r.series[2].drawdown).toBeCloseTo(-0.1, 12);
      expect(r.metrics.totalReturn).toBeCloseTo(0.21, 12);
      expect(r.metrics.maxDrawdown).toBeCloseTo(0.1, 12);
    }
    expect(result.runs[0].metrics.sharpe).toBeCloseTo(result.runs[1].metrics.sharpe!, 10);
    expect(result.runs.map((r) => r.excludedDates)).toEqual([3, 1]);
    expect(result.likeForLike).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it("counts trades, costs and turnover only for trades entered in the window", () => {
    const trade = (day: number) => ({
      entryFillTs: new Date(START + day * DAY).toISOString(), entryPrice: 10, entryQuantity: 10, exitPrice: 10, exitQuantity: 10, fees: 5, slippage: 5,
    });
    const a = run("a", 0, [1000, 1000, 1000, 1000, 1000], { trades: [trade(0), trade(2), trade(3)] });
    const b = run("b", 2, [500, 500, 500]);
    const [ra] = compareRuns([a, b]).runs;
    expect(ra.metrics.tradeCount).toBe(2);
    expect(ra.metrics.costDrag).toBeCloseTo(20 / 1000, 12);
    expect(ra.metrics.turnover).toBeCloseTo(400 / 1000, 12);
  });

  it("states a non-overlap and reports no metrics", () => {
    const result = compareRuns([run("a", 0, [100, 101]), run("b", 10, [100, 99])]);
    expect(result.intersection).toMatchObject({ status: "NO_OVERLAP", commonDates: 0, from: null, to: null });
    expect(result.intersection.statement).toContain("share no market dates");
    for (const r of result.runs) {
      expect(r.series).toEqual([]);
      expect(Object.values(r.metrics).every((v) => v === null)).toBe(true);
    }
    expect(result.runs[1].ownWindow).toEqual({ from: "2024-01-11", to: "2024-01-12", dates: 2 });
  });

  it("a single shared date gives no return, CAGR, drawdown or Sharpe", () => {
    const result = compareRuns([run("a", 0, [100, 101]), run("b", 1, [200, 210])]);
    expect(result.intersection).toMatchObject({ status: "SINGLE_DAY", commonDates: 1, from: "2024-01-02", to: "2024-01-02" });
    for (const r of result.runs) {
      expect(r.series).toEqual([{ date: "2024-01-02", equity: 100, drawdown: 0 }]);
      expect(r.metrics).toMatchObject({ totalReturn: null, cagr: null, maxDrawdown: null, sharpe: null, tradeCount: 0 });
    }
  });

  it("flags runs that used different costs, benchmarks, timeframes or engines", () => {
    const base = run("a", 0, [100, 101, 102]);
    const other = run("b", 0, [100, 99, 101], {
      costAssumptions: effectiveCostAssumptions({ slippageBps: 10, feeModel: "FIXED_BPS" }),
      benchmarkSymbol: "NIFTY50",
      timeframe: "1h",
      engineVersion: "3.0.0",
    });
    const result = compareRuns([base, other]);
    expect(result.likeForLike).toBe(false);
    expect(result.flags.map((f) => f.code)).toEqual(["COST_ASSUMPTIONS_DIFFER", "BENCHMARK_DIFFERS", "TIMEFRAME_DIFFERS", "ENGINE_VERSION_DIFFERS"]);
    const costFlag = result.flags[0].message;
    for (const field of ["feeModel", "feeBps", "exchange", "product", "brokerage", "slippageBps"]) expect(costFlag).toContain(field);
    expect(result.flags[1].message).toContain("none, NIFTY50");
  });
});

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------

function storedTrade(overrides: Partial<StoredTrade> = {}): StoredTrade {
  return {
    symbol: "TESTSYM", direction: "LONG",
    entrySignalTimestamp: new Date("2024-01-10T00:00:00.000Z"), entryFillTimestamp: new Date("2024-01-11T00:00:00.000Z"),
    entryPrice: "101.5000", entryQuantity: "100.0000",
    exitSignalTimestamp: null, exitFillTimestamp: new Date("2024-01-20T00:00:00.000Z"),
    exitPrice: "110.0000", exitQuantity: "100.0000", grossPnl: "850.0000", fees: "40.0000", slippage: "10.0000", netPnl: "800.0000",
    returnPercent: "7.880000", holdingBars: 9, mfe: "900.0000", mae: "-50.0000", entryReason: "SMA(5) crosses above SMA(20)", exitReason: "EXIT_SIGNAL",
    ...overrides,
  };
}

function storedRun(overrides: { metadata?: boolean; jobId?: string; sharpe?: string; benchmark?: string | null; benchmarkSeries?: boolean } = {}): StoredRun {
  const bars = candles(60);
  const metadata = overrides.metadata === false ? null : buildRunMetadata({
    symbols: ["TESTSYM"], candles: bars, engineVersion: "4.0.0", indicatorVersion: "ind-1", feeModelVersion: "2.0.0",
    env: { GIT_SHA: "0123abc" } as NodeJS.ProcessEnv,
  });
  return {
    job: {
      id: overrides.jobId ?? "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222",
      symbolOrUniverse: "TESTSYM", timeframe: "1d", fromDate: new Date(START), toDate: new Date(START + 59 * DAY),
      initialCapital: "250000.0000", benchmarkSymbol: overrides.benchmark === undefined ? null : overrides.benchmark,
      requestedAt: new Date("2024-03-01T00:00:00.000Z"), completedAt: new Date("2024-03-01T00:01:00.000Z"),
      reproducibilityMetadata: metadata, warnings: [],
    },
    version: {
      id: "33333333-3333-4333-8333-333333333333", strategyId: "44444444-4444-4444-8444-444444444444", strategyName: "Cross",
      versionNumber: 3, definition: definition({ slippageBps: 7 }), definitionHash: "defhash", engineVersion: "4.0.0", indicatorVersion: "ind-1", schemaVersion: 1,
    },
    snapshot: {
      totalReturn: "0.032000", annualizedReturn: "0.210000", maxDrawdown: "0.050000", sharpe: overrides.sharpe ?? "1.2000", sortino: "1.5000",
      calmar: "4.2000", winRate: "1.000000", profitFactor: null, expectancy: "800.000000", tradeCount: 1, longTradeCount: 1, shortTradeCount: 0,
      feesPaid: "40.0000", slippageCost: "10.0000", netProfit: "800.0000", exposurePercent: "15.000000", benchmarkReturn: "0.000000", alpha: "0.000000",
      dataHash: candleFingerprint(bars).slice(0, 16), engineVersion: "4.0.0", feeModel: "2.0.0", warnings: [],
    },
    trades: [storedTrade()],
    equity: [100, 104, 98, 103.2].map((v, i) => ({
      timestamp: new Date(START + i * 10 * DAY), equity: (v * 2500).toFixed(4), benchmark: overrides.benchmarkSeries ? "100.0000" : null,
    })),
  };
}

describe("run report", () => {
  it("describes the run and hashes everything reproducible", () => {
    const report = buildRunReport(storedRun({ benchmark: "NIFTY50", benchmarkSeries: true }), new Date("2026-01-01T00:00:00.000Z"));
    expect(report.reproducible.server.gitCommitSha).toBe("0123abc");
    expect(report.reproducible.versions).toEqual({
      strategyEngine: "4.0.0", strategyEnginePinned: "4.0.0", indicatorEnginePinned: "ind-1", indicatorEngine: "ind-1", feeModel: "2.0.0",
    });
    expect(report.reproducible.data).toMatchObject({
      symbols: ["TESTSYM"], timeframe: "1d", candleCount: 60, candleSha256: candleFingerprint(candles(60)),
      window: { from: new Date(START).toISOString(), to: new Date(START + 59 * DAY).toISOString() },
    });
    expect(report.reproducible.execution).toMatchObject({ initialCapital: 250_000, slippageBps: 7, fillPolicy: "NEXT_BAR_OPEN", feeModel: "VOLUME_AWARE" });
    expect(report.reproducible.benchmark).toEqual({ symbol: "NIFTY50", applied: true });
    expect(report.reproducible.metrics).toMatchObject({ sharpe: 1.2, totalReturn: 0.032, profitFactor: null, benchmarkReturn: 0 });
    expect(report.reproducible.missingFields).toEqual([]);
    expect(report.reproducibilityHash.value).toBe(sha256Hex(canonicalJson(report.reproducible)));
    expect(report.warnings).toEqual([]);
  });

  it("gives the same hash for the same run regardless of identifiers and generation time", () => {
    const first = buildRunReport(storedRun(), new Date("2026-01-01T00:00:00.000Z"));
    const again = buildRunReport(storedRun({ jobId: "55555555-5555-4555-8555-555555555555" }), new Date("2026-06-01T00:00:00.000Z"));
    expect(again.reproducibilityHash.value).toBe(first.reproducibilityHash.value);
    expect(again.identity.jobId).not.toBe(first.identity.jobId);
  });

  it("changes the hash when a result, the data or the server revision differs", () => {
    const base = buildRunReport(storedRun(), new Date()).reproducibilityHash.value;
    expect(buildRunReport(storedRun({ sharpe: "1.2001" }), new Date()).reproducibilityHash.value).not.toBe(base);
    const otherTrades = storedRun();
    otherTrades.trades = [storedTrade({ fees: "41.0000" })];
    expect(buildRunReport(otherTrades, new Date()).reproducibilityHash.value).not.toBe(base);
    const otherServer = storedRun();
    otherServer.job.reproducibilityMetadata = { ...otherServer.job.reproducibilityMetadata!, gitCommitSha: "fff" };
    expect(buildRunReport(otherServer, new Date()).reproducibilityHash.value).not.toBe(base);
  });

  it("shows fields an older run never recorded as missing instead of guessing them", () => {
    const report = buildRunReport(storedRun({ metadata: false }), new Date());
    // Before any matcher touches the record: the hash covers exactly what is known.
    expect(report.reproducibilityHash.value).toBe(sha256Hex(canonicalJson(report.reproducible)));
    expect(report.reproducible.server.gitCommitSha).toBeNull();
    const { data } = report.reproducible;
    expect([data.candleCount, data.candleSha256, data.firstCandleTs, data.lastCandleTs]).toEqual([null, null, null, null]);
    expect(data.engineDataHash).toMatch(/^[0-9a-f]{16}$/);
    expect(report.reproducible.versions.indicatorEngine).toBeNull();
    expect(report.reproducible.versions.strategyEngine).toBe("4.0.0");
    expect(report.reproducible.missingFields).toEqual([
      "versions.indicatorEngine", "server.gitCommitSha", "data.candleCount", "data.firstCandleTs", "data.lastCandleTs", "data.candleSha256",
    ]);
    expect(report.warnings[0]).toContain("not recorded");
  });

  it("does not report a benchmark return for a benchmark that was never applied", () => {
    const report = buildRunReport(storedRun({ benchmark: "NIFTY50" }), new Date());
    expect(report.reproducible.benchmark).toEqual({ symbol: "NIFTY50", applied: false });
    expect(report.reproducible.metrics.benchmarkReturn).toBeNull();
    expect(report.reproducible.metrics.alpha).toBeNull();
    expect(report.warnings.some((w) => w.includes("NIFTY50"))).toBe(true);
  });

  it("CSV digests in the report match the downloadable files", () => {
    const run = storedRun();
    const report = buildRunReport(run, new Date());
    expect(runCsv(run, "trades").sha256).toBe(report.reproducible.results.tradesCsvSha256);
    expect(runCsv(run, "equity").sha256).toBe(report.reproducible.results.equityCsvSha256);
    expect(runCsv(run, "equity").filename).toBe(`maet-run-${run.job.id}-equity.csv`);
  });

  it("writes trades in fill order with quoted text and neutralised formulas", () => {
    const csv = tradesCsv([
      storedTrade({ entryFillTimestamp: new Date("2024-02-01T00:00:00.000Z"), entryReason: '=HYPERLINK("x"), "quoted"' }),
      storedTrade({ exitReason: "@cmd" }),
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "symbol,direction,entry_signal_ts,entry_fill_ts,entry_price,entry_quantity,exit_signal_ts,exit_fill_ts,exit_price,exit_quantity,gross_pnl,fees,slippage,net_pnl,return_percent,holding_bars,mfe,mae,entry_reason,exit_reason",
    );
    expect(lines[1]).toContain("2024-01-11T00:00:00.000Z");
    expect(lines[1].endsWith(",'@cmd")).toBe(true);
    expect(lines[2]).toContain(`"'=HYPERLINK(""x""), ""quoted"""`);
    // Signed numbers stay numbers.
    expect(lines[1]).toContain(",-50.0000,");
  });

  it("writes the equity curve with its drawdown from the running peak", () => {
    const csv = equityCsv([
      { timestamp: new Date("2024-01-02T00:00:00.000Z"), equity: "120.0000", benchmark: null },
      { timestamp: new Date("2024-01-01T00:00:00.000Z"), equity: "100.0000", benchmark: "50.0000" },
      { timestamp: new Date("2024-01-03T00:00:00.000Z"), equity: "90.0000", benchmark: null },
    ]);
    expect(csv).toBe(
      "timestamp,equity,benchmark,drawdown\r\n2024-01-01T00:00:00.000Z,100.0000,50.0000,0\r\n2024-01-02T00:00:00.000Z,120.0000,,0\r\n2024-01-03T00:00:00.000Z,90.0000,,-0.25\r\n",
    );
  });
});
