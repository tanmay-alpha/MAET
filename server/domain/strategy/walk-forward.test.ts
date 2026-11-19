import { describe, it, expect } from "bun:test";
import {
  DAY_MS,
  countWalkForwardWindows,
  generate3PhaseWalkForwardWindows,
  assertNoDataLeakage,
  runWalkForwardAnalysis,
  walkForwardRange,
  walkForwardRunSpans,
  type WalkForwardAnalysisInput,
  type WalkForwardSpans,
} from "./walk-forward";
import { runBacktestV3 } from "./runner-v3";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

function makeCandles(length = 200, startPrice = 100, trend = 0.5): Candle[] {
  return Array.from({ length }, (_, i) => {
    const d = new Date("2024-01-01T09:15:00.000Z");
    d.setDate(d.getDate() + i);
    const price = startPrice + i * trend;
    return {
      symbol: "TEST",
      tf: "1d",
      ts: d.toISOString(),
      open: price,
      high: price + 2,
      low: price - 2,
      close: price,
      volume: 100_000,
      source: "test",
    };
  });
}

function makeSmaCrossDef(): StrategyDefinition {
  return {
    name: "SmaCross",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP",
      id: "entry",
      combinator: "AND",
      children: [
        {
          kind: "CONDITION",
          id: "e1",
          left: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
          operator: "GREATER_THAN",
          right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
        },
      ],
    },
    exit: {
      kind: "GROUP",
      id: "exit",
      combinator: "OR",
      children: [
        {
          kind: "CONDITION",
          id: "x1",
          left: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
          operator: "LESS_THAN",
          right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
        },
      ],
    },
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: 100,
      maximumOpenPositions: 1,
      allowPyramiding: false,
    },
    execution: {
      fillPolicy: "NEXT_BAR_OPEN",
      intrabarPolicy: "CONSERVATIVE",
      feeModel: "NONE",
      feeBps: 0,
      slippageBps: 0,
      initialCapital: 100_000,
    },
  };
}

/** mulberry32: seeded PRNG for reproducible property loops. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("walk-forward windows honour the requested spans", () => {
  it("splits a 2024 run with 120 training and 40 validation/test days into windows of exactly those lengths", () => {
    // The API's inclusive 2024-01-01 .. 2024-12-31 range is 366 days. The old generator cut it into
    // n equal slices and applied ratios, giving ~91-day windows whatever the request said.
    const spans = walkForwardRunSpans({ trainingDays: 120, validationDays: 40 });
    expect(spans).toEqual({ trainingDays: 120, validationDays: 40, testDays: 40 });
    const { rangeStart, rangeEnd } = walkForwardRange(new Date("2024-01-01T00:00:00.000Z"), new Date("2024-12-31T23:59:59.999Z"));
    const windows = generate3PhaseWalkForwardWindows(rangeStart, rangeEnd, "ROLLING", spans);

    // 366 - (120 + 40 + 40) = 166 days left: 4 more test steps of 40 days fit.
    expect(windows).toHaveLength(5);
    for (const w of windows) {
      expect(w.trainEnd.getTime() - w.trainStart.getTime()).toBe(120 * DAY_MS);
      expect(w.valEnd.getTime() - w.valStart.getTime()).toBe(40 * DAY_MS);
      expect(w.testEnd.getTime() - w.testStart.getTime()).toBe(40 * DAY_MS);
    }
    expect(windows[4].testEnd.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    // Five 40-day test segments end on 1 Jan 2025, so the first starts 200 days earlier; its
    // training starts on 7 Jan, inside the range (the 6 days before it are left unused).
    expect(windows[0].testStart.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    expect(windows[0].trainStart.toISOString()).toBe("2024-01-07T00:00:00.000Z");
  });

  it("counts a window only once all three spans fit", () => {
    const spans: WalkForwardSpans = { trainingDays: 30, validationDays: 10, testDays: 10 };
    expect(countWalkForwardWindows(50 * DAY_MS - 1, spans)).toBe(0);
    expect(countWalkForwardWindows(50 * DAY_MS, spans)).toBe(1);
    expect(countWalkForwardWindows(60 * DAY_MS - 1, spans)).toBe(1);
    expect(countWalkForwardWindows(60 * DAY_MS, spans)).toBe(2);
    expect(countWalkForwardWindows(1000 * DAY_MS, { ...spans, testDays: 0 })).toBe(0);
  });

  it("tiles test segments back from the range end with exact, adjacent, in-range phases (random specs)", () => {
    const next = rng(2026);
    for (let k = 0; k < 300; k++) {
      const spans: WalkForwardSpans = {
        trainingDays: 1 + Math.floor(next() * 200),
        validationDays: 1 + Math.floor(next() * 60),
        testDays: 1 + Math.floor(next() * 60),
      };
      const mode = next() < 0.5 ? "ROLLING" : "ANCHORED";
      const start = Date.UTC(2020, 0, 1) + Math.floor(next() * 1000) * 3_600_000;
      const rangeMs = Math.floor(next() * 1500 * DAY_MS);
      const fit = countWalkForwardWindows(rangeMs, spans);
      const maxWindows = next() < 0.5 ? undefined : Math.floor(next() * 30);
      const windows = generate3PhaseWalkForwardWindows(new Date(start), new Date(start + rangeMs), mode, spans, maxWindows);

      expect(windows).toHaveLength(maxWindows === undefined ? fit : Math.min(fit, maxWindows));
      // `fit` is maximal: one more test step would start the first window before the range.
      if (fit > 0) expect(rangeMs - (spans.trainingDays + spans.validationDays + fit * spans.testDays) * DAY_MS).toBeLessThan(spans.testDays * DAY_MS);
      windows.forEach((w, i) => {
        expect(w.trainEnd.getTime()).toBe(w.valStart.getTime());
        expect(w.valEnd.getTime()).toBe(w.testStart.getTime());
        expect(w.valEnd.getTime() - w.valStart.getTime()).toBe(spans.validationDays * DAY_MS);
        expect(w.testEnd.getTime() - w.testStart.getTime()).toBe(spans.testDays * DAY_MS);
        if (mode === "ROLLING") expect(w.trainEnd.getTime() - w.trainStart.getTime()).toBe(spans.trainingDays * DAY_MS);
        else expect(w.trainStart.getTime()).toBe(start);
        expect(w.trainEnd.getTime() - w.trainStart.getTime()).toBeGreaterThanOrEqual(spans.trainingDays * DAY_MS);
        expect(w.trainStart.getTime()).toBeGreaterThanOrEqual(start);
        if (i > 0) expect(w.testStart.getTime()).toBe(windows[i - 1].testEnd.getTime());
      });
      if (windows.length > 0) expect(windows[windows.length - 1].testEnd.getTime()).toBe(start + rangeMs);
    }
  });
});

describe("P2 Leakage-Free 3-Phase Walk-Forward Analysis (Commit 7)", () => {
  it("2. ZERO DATA LEAKAGE GUARD: throws error if validation or test timestamps overlap with train", () => {
    const cleanTrain = [
      { symbol: "T", tf: "1d", ts: "2024-01-01T00:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 100, source: "test" },
    ];
    const cleanVal = [
      { symbol: "T", tf: "1d", ts: "2024-02-01T00:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 100, source: "test" },
    ];
    const cleanTest = [
      { symbol: "T", tf: "1d", ts: "2024-03-01T00:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 100, source: "test" },
    ];

    // Clean partition does not throw
    expect(() => assertNoDataLeakage(cleanTrain as any, cleanVal as any, cleanTest as any)).not.toThrow();

    // Leakage case 1: Training candle is newer than validation start
    const leakyTrain = [
      { symbol: "T", tf: "1d", ts: "2024-02-15T00:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 100, source: "test" },
    ];
    expect(() => assertNoDataLeakage(leakyTrain as any, cleanVal as any, cleanTest as any)).toThrow(
      /DATA LEAKAGE DETECTED/,
    );

    // Leakage case 2: Validation candle is newer than test start
    const leakyVal = [
      { symbol: "T", tf: "1d", ts: "2024-03-15T00:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 100, source: "test" },
    ];
    expect(() => assertNoDataLeakage(cleanTrain as any, leakyVal as any, cleanTest as any)).toThrow(
      /DATA LEAKAGE DETECTED/,
    );
  });

  it("3. End-to-end 3-phase walk-forward analysis: separates IS, Validation, and OOS reporting", async () => {
    const candles = makeCandles(800, 100, 0.1);

    const input: WalkForwardAnalysisInput = {
      strategyVersionId: "wf-test-strat",
      definition: makeSmaCrossDef(),
      symbol: "TEST",
      candles,
      trainingDays: 200,
      validationDays: 60,
      testDays: 60,
      maxWindows: 3,
      windowType: "ROLLING",
      parameters: [
        { name: "fast", path: "entry.children.0.left.params.period", values: [5, 10, 15] },
      ],
    };

    const result = await runWalkForwardAnalysis(input);

    // 800 days fit many windows; maxWindows keeps the 3 most recent, ending with the data.
    expect(result.windows).toHaveLength(3);
    expect(new Date(result.windows[2].testDates.to).getTime()).toBe(new Date(candles[799].ts).getTime() + 1);

    for (const w of result.windows) {
      // Must distinctly report all 3 phases
      expect(w.isMetrics).toBeDefined();
      expect(w.valMetrics).toBeDefined();
      expect(w.oosMetrics).toBeDefined();
      expect(w.selectedParameters).toBeDefined();
    }

    // Summary must report IS vs OOS metrics separately
    expect(result.summary.isReturnAvg).toBeDefined();
    expect(result.summary.oosReturnTotal).toBeDefined();
    expect(result.summary.performanceRetention).toBeDefined();
    expect(result.summary.walkForwardEfficiency).toBeDefined();

    // Aggregate OOS curve must be present
    expect(result.aggregateOosEquityCurve.length).toBeGreaterThan(0);
  });
});

/** Daily candles whose per-bar drift changes by phase; alternating ±0.4% noise keeps volatility > 0. */
function makePhasedCandles(drifts: Array<{ bars: number; drift: number }>): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (const { bars, drift } of drifts) {
    for (let k = 0; k < bars; k++) {
      const i = out.length;
      price *= 1 + drift + (i % 2 === 0 ? 0.004 : -0.004);
      out.push({ symbol: "TEST", tf: "1d", ts: new Date(Date.UTC(2023, 0, 1 + i)).toISOString(), open: price, high: price * 1.002, low: price * 0.998, close: price, volume: 100_000, source: "test" });
    }
  }
  return out;
}

function alwaysLong(): StrategyDefinition {
  return {
    ...makeSmaCrossDef(),
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
    },
    exit: { kind: "GROUP", id: "exit", combinator: "OR", children: [] },
  };
}

describe("walk-forward — validation, warm-up and efficiency", () => {
  const start = Date.UTC(2023, 0, 1);
  /** One window over the 300 daily bars of makePhasedCandles: 180 training, 60 validation, 60 test. */
  const singleWindow = (candles: Candle[]): WalkForwardAnalysisInput => ({
    strategyVersionId: "wf",
    definition: alwaysLong(),
    symbol: "TEST",
    candles,
    parameters: [],
    trainingDays: 180,
    validationDays: 60,
    testDays: 60,
    rangeStart: new Date(start),
    rangeEnd: new Date(start + 300 * DAY_MS),
  });

  it("holds cash for a rejected window's test segment and counts it in every OOS aggregate", async () => {
    // 300 bars: rising training (180), collapsing validation (60), rising test (60).
    const candles = makePhasedCandles([{ bars: 180, drift: 0.003 }, { bars: 60, drift: -0.01 }, { bars: 60, drift: 0.003 }]);
    const result = await runWalkForwardAnalysis(singleWindow(candles));

    expect(result.windows).toHaveLength(1);
    const [w] = result.windows;
    expect(w.validationAccepted).toBe(false);
    expect(w.rejectionReason).toMatch(/validation Sharpe/);
    expect(w.oosPosition).toBe("CASH");
    expect(w.cashReason).toBe(w.rejectionReason);
    expect(w.oosMetrics).toEqual({ totalReturn: 0, annualisedReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 });
    // A flat segment: the as-of mark before the test plus every test bar, all at the starting capital.
    expect(result.aggregateOosEquityCurve).toHaveLength(61);
    expect(new Set(result.aggregateOosEquityCurve.map((p) => p.equity))).toEqual(new Set([100_000]));
    expect(result.summary).toMatchObject({ oosReturnTotal: 0, oosSharpe: 0, oosDrawdownMax: 0, testedWindowsCount: 0, cashWindowsCount: 1, totalWindowsCount: 1 });
    // The in-sample return was positive, so efficiency is defined: zero, not hidden as "no window".
    expect(w.isMetrics!.annualisedReturn).toBeGreaterThan(0);
    expect(result.summary.walkForwardEfficiency).toBe(0);
    expect(result.summary.performanceRetention).toBe(0);
  });

  it("stitches every test segment and averages over all windows when the strategy fails most of them", async () => {
    // 5 windows of 60 training, 20 validation and 20 test days over 180 days. The market crashes
    // over days 60-140, so windows 1-4 fail validation; window 5 validates on 140-160 and trades
    // 160-180.
    const candles = makePhasedCandles([{ bars: 60, drift: 0.003 }, { bars: 80, drift: -0.01 }, { bars: 40, drift: 0.003 }]);
    const result = await runWalkForwardAnalysis({
      ...singleWindow(candles),
      trainingDays: 60,
      validationDays: 20,
      testDays: 20,
      rangeEnd: new Date(start + 180 * DAY_MS),
    });

    expect(result.windows.map((w) => w.oosPosition)).toEqual(["CASH", "CASH", "CASH", "CASH", "STRATEGY"]);
    const traded = result.windows[4].oosMetrics;
    expect(traded.sharpe).toBeGreaterThan(0);
    // Cash windows count with zero: the mean is a fifth of the traded window's, not equal to it.
    expect(result.summary.oosSharpeAvg).toBeCloseTo(traded.sharpe / 5, 12);
    expect(result.summary.oosAnnualisedAvg).toBeCloseTo(traded.annualisedReturn / 5, 12);
    expect(result.summary).toMatchObject({ testedWindowsCount: 1, cashWindowsCount: 4, acceptedWindowsCount: 1, totalWindowsCount: 5 });

    // The stitched curve covers every test bar (days 80-179) once, in order, flat while in cash.
    const curve = result.aggregateOosEquityCurve;
    expect(curve).toHaveLength(101);
    expect(curve[0].timestamp).toBe(start + 79 * DAY_MS);
    expect(curve[curve.length - 1].timestamp).toBe(start + 179 * DAY_MS);
    curve.slice(1).forEach((p, i) => expect(p.timestamp).toBe(curve[i].timestamp + DAY_MS));
    expect(curve.filter((p) => p.timestamp < start + 160 * DAY_MS).every((p) => p.equity === 100_000)).toBe(true);
    expect(result.summary.oosReturnTotal).toBeCloseTo(traded.totalReturn, 12);
    expect(result.summary.oosReturnTotal).toBeCloseTo(curve[curve.length - 1].equity / curve[0].equity - 1, 12);
  });

  it("benchmarks buy-and-hold over the same OOS dates with the strategy's own costs", async () => {
    const candles = makePhasedCandles([{ bars: 60, drift: 0.003 }, { bars: 80, drift: -0.01 }, { bars: 40, drift: 0.003 }]);
    const run = (feeBps: number) => {
      const base = alwaysLong();
      return runWalkForwardAnalysis({
        ...singleWindow(candles),
        definition: { ...base, execution: { ...base.execution!, feeModel: "FIXED_BPS", feeBps, slippageBps: 10 } },
        trainingDays: 60,
        validationDays: 20,
        testDays: 20,
        rangeEnd: new Date(start + 180 * DAY_MS),
      });
    };
    const [cheap, costly] = await Promise.all([run(0), run(50)]);

    const bh = costly.benchmark!;
    expect(bh.kind).toBe("BUY_AND_HOLD");
    expect(bh.from).toBe(costly.windows[0].testDates.from);
    expect(bh.to).toBe(costly.windows[costly.windows.length - 1].testDates.to);
    expect(bh.tradeCount).toBe(1);
    // Same dates, same costs: an independent buy-and-hold over the test span with these settings.
    const independent = runBacktestV3({
      strategyVersionId: "bh",
      definition: { ...alwaysLong(), execution: { ...alwaysLong().execution!, feeModel: "FIXED_BPS", feeBps: 50, slippageBps: 10 } },
      symbol: "TEST",
      candles: candles.slice(0, 180),
      tradeFrom: start + 80 * DAY_MS,
    });
    expect(bh.totalReturn).toBeCloseTo(independent.metrics.totalReturn, 12);
    // Two legs of 50 bps cost about 1% more than the fee-free run over the same dates.
    expect(cheap.benchmark!.totalReturn - bh.totalReturn).toBeGreaterThan(0.008);
  });

  it("reports WFE as undefined (null, with a reason) when the in-sample return is not positive", async () => {
    // Falling training, quiet validation (accepted), rising test.
    const candles = makePhasedCandles([{ bars: 180, drift: -0.002 }, { bars: 60, drift: 0 }, { bars: 60, drift: 0.003 }]);
    const result = await runWalkForwardAnalysis(singleWindow(candles));

    expect(result.summary.testedWindowsCount).toBe(1);
    expect(result.windows[0].isMetrics!.annualisedReturn).toBeLessThan(0);
    expect(result.summary.walkForwardEfficiency).toBeNull();
    expect(result.summary.walkForwardEfficiencyReason).toMatch(/In-sample annualised return/);
    expect(result.summary.performanceRetention).toBeNull();
  });

  it("records the methodology: phase spans, sample labels and trials per window", async () => {
    const candles = makePhasedCandles([{ bars: 300, drift: 0.002 }]);
    const result = await runWalkForwardAnalysis({
      ...singleWindow(candles),
      definition: makeSmaCrossDef(),
      parameters: [{ name: "fast", path: "entry.children.0.left.params.period", values: [5, 10, 15] }],
    });
    expect(result.methodology).toEqual({
      windowType: "ROLLING",
      trainingDays: 180,
      validationDays: 60,
      testDays: 60,
      dayBasis: "CALENDAR",
      stepDays: 60,
      selection: { sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_TRAINING_SHARPE", trialsPerWindow: 3 },
      validation: { sample: "OUT_OF_SAMPLE_HOLDOUT", rule: "VETO_IF_SHARPE_BELOW", sharpeFloor: -1 },
      test: { sample: "OUT_OF_SAMPLE" },
      rejectedWindowPolicy: "CASH",
    });
  });

  it("tests short out-of-sample windows using earlier bars to warm up indicators", async () => {
    // 4 windows with 20-day test phases, fewer than the runner's 50-bar minimum and than SMA(20)
    // needs, so without warm-up history every test run would fail.
    const candles = makePhasedCandles([{ bars: 400, drift: 0.002 }]);
    const result = await runWalkForwardAnalysis({
      ...singleWindow(candles),
      definition: makeSmaCrossDef(),
      trainingDays: 60,
      validationDays: 20,
      testDays: 20,
      maxWindows: 4,
      rangeEnd: new Date(start + 400 * DAY_MS),
    });

    expect(result.summary.totalWindowsCount).toBe(4);
    expect(result.summary.acceptedWindowsCount).toBeGreaterThan(0);
    expect(result.summary.testedWindowsCount).toBe(result.summary.acceptedWindowsCount);
    expect(result.warnings.filter((m) => /failed/.test(m))).toEqual([]);
  });

  it("hands control back between backtests so a long analysis cannot monopolise the event loop", async () => {
    const candles = makePhasedCandles([{ bars: 300, drift: 0.002 }]);
    let yields = 0;
    const result = await runWalkForwardAnalysis(
      { ...singleWindow(candles), definition: makeSmaCrossDef(), parameters: [{ name: "fast", path: "entry.children.0.left.params.period", values: [5, 10] }] },
      { yieldControl: async () => { yields += 1; } },
    );

    // Two training runs, one validation run, one test run and the buy-and-hold benchmark.
    expect(result.summary.testedWindowsCount).toBe(1);
    expect(yields).toBe(5);
  });

  it("aborts when yieldControl throws instead of recording the error as a failed training run", async () => {
    const candles = makePhasedCandles([{ bars: 300, drift: 0.002 }]);
    const stop = new Error("runner stopping");

    await expect(runWalkForwardAnalysis(singleWindow(candles), { yieldControl: async () => { throw stop; } })).rejects.toBe(stop);
  });
});
