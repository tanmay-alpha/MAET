import { describe, it, expect } from "bun:test";
import {
  generate3PhaseWalkForwardWindows,
  assertNoDataLeakage,
  runWalkForwardAnalysis,
  type WalkForwardAnalysisInput,
} from "./walk-forward";
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

describe("P2 Leakage-Free 3-Phase Walk-Forward Analysis (Commit 7)", () => {
  it("1. generate3PhaseWalkForwardWindows: generates non-overlapping Train -> Val -> Test windows", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const end = new Date("2024-12-31T00:00:00Z");
    const windows = generate3PhaseWalkForwardWindows(start, end, "ROLLING", 4, 0.6, 0.2);

    expect(windows).toHaveLength(4);

    for (const w of windows) {
      // 1. Train precedes Validation
      expect(w.trainStart.getTime()).toBeLessThan(w.trainEnd.getTime());
      expect(w.trainEnd.getTime()).toBeLessThanOrEqual(w.valStart.getTime());

      // 2. Validation precedes Test
      expect(w.valStart.getTime()).toBeLessThan(w.valEnd.getTime());
      expect(w.valEnd.getTime()).toBeLessThanOrEqual(w.testStart.getTime());

      // 3. Test spans to window end
      expect(w.testStart.getTime()).toBeLessThan(w.testEnd.getTime());
    }
  });

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

  it("3. End-to-end 3-phase walk-forward analysis: separates IS, Validation, and OOS reporting", () => {
    const candles = makeCandles(800, 100, 0.1);

    const input: WalkForwardAnalysisInput = {
      strategyVersionId: "wf-test-strat",
      definition: makeSmaCrossDef(),
      symbol: "TEST",
      candles,
      numWindows: 3,
      windowType: "ROLLING",
      trainRatio: 0.6,
      valRatio: 0.2,
      parameters: [
        { name: "fast", path: "entry.children.0.left.params.period", values: [5, 10, 15] },
      ],
    };

    const result = runWalkForwardAnalysis(input);

    expect(result.windows.length).toBeGreaterThanOrEqual(1);

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
  const singleWindow = (candles: Candle[]): WalkForwardAnalysisInput => ({
    strategyVersionId: "wf",
    definition: alwaysLong(),
    symbol: "TEST",
    candles,
    parameters: [],
    numWindows: 1,
    trainRatio: 0.6,
    valRatio: 0.2,
  });

  it("does not test or count a window that validation rejected", () => {
    // 300 bars: rising training (180), collapsing validation (60), rising test (60).
    const candles = makePhasedCandles([{ bars: 180, drift: 0.003 }, { bars: 60, drift: -0.01 }, { bars: 60, drift: 0.003 }]);
    const result = runWalkForwardAnalysis(singleWindow(candles));

    expect(result.windows).toHaveLength(1);
    const [w] = result.windows;
    expect(w.validationAccepted).toBe(false);
    expect(w.rejectionReason).toMatch(/validation Sharpe/);
    expect(w.oosMetrics).toBeNull();
    expect(result.aggregateOosEquityCurve).toHaveLength(0);
    expect(result.summary.oosReturnTotal).toBe(0);
    expect(result.summary.testedWindowsCount).toBe(0);
    expect(result.summary.walkForwardEfficiency).toBeNull();
    expect(result.summary.walkForwardEfficiencyReason).toMatch(/No window/);
  });

  it("reports WFE as undefined (null, with a reason) when the in-sample return is not positive", () => {
    // Falling training, quiet validation (accepted), rising test.
    const candles = makePhasedCandles([{ bars: 180, drift: -0.002 }, { bars: 60, drift: 0 }, { bars: 60, drift: 0.003 }]);
    const result = runWalkForwardAnalysis(singleWindow(candles));

    expect(result.summary.testedWindowsCount).toBe(1);
    expect(result.windows[0].isMetrics.annualisedReturn).toBeLessThan(0);
    expect(result.summary.walkForwardEfficiency).toBeNull();
    expect(result.summary.walkForwardEfficiencyReason).toMatch(/In-sample annualised return/);
    expect(result.summary.performanceRetention).toBeNull();
  });

  it("tests short out-of-sample windows using earlier bars to warm up indicators", () => {
    // 4 windows of 100 bars: each test phase has ~20 bars, fewer than the runner's 50-bar minimum
    // and than SMA(20) needs, so without warm-up history every test run would fail.
    const candles = makePhasedCandles([{ bars: 400, drift: 0.002 }]);
    const result = runWalkForwardAnalysis({
      ...singleWindow(candles),
      definition: makeSmaCrossDef(),
      numWindows: 4,
    });

    expect(result.summary.acceptedWindowsCount).toBeGreaterThan(0);
    expect(result.summary.testedWindowsCount).toBe(result.summary.acceptedWindowsCount);
    expect(result.warnings.filter((m) => /failed/.test(m))).toEqual([]);
  });
});
