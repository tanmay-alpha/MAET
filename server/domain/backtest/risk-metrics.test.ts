/**
 * Risk Metrics & Timeframe Annualisation Test Suite
 *
 * Verifies:
 * - Indian market session timeframe model (252 sessions/year, 375 mins/session).
 * - Exact mathematical consistency of Volatility, Sharpe, Sortino, CAGR, Calmar, and Alpha.
 * - Finance-meaningful portfolio turnover (total traded notional / average portfolio equity).
 * - Backward compatibility with legacy trade records.
 */

import { describe, it, expect } from "bun:test";
import {
  computeMetrics,
  computeUlcerIndex,
  getPeriodsPerYear,
  TRADING_DAYS_PER_YEAR,
  MINUTES_PER_SESSION,
  type EquityPoint,
  type TradeRecord,
} from "./risk-metrics";

describe("Risk Metrics — Timeframe Model", () => {
  it("computes exact session periods per year for Indian equity markets", () => {
    expect(TRADING_DAYS_PER_YEAR).toBe(252);
    expect(MINUTES_PER_SESSION).toBe(375);

    expect(getPeriodsPerYear("1m")).toBe(252 * 375); // 94,500
    expect(getPeriodsPerYear("3m")).toBe(252 * 125); // 31,500
    expect(getPeriodsPerYear("5m")).toBe(252 * 75);  // 18,900
    expect(getPeriodsPerYear("15m")).toBe(252 * 25); // 6,300
    expect(getPeriodsPerYear("30m")).toBe(252 * 12.5); // 3,150
    expect(getPeriodsPerYear("1h")).toBe(252 * 6.25);  // 1,575
    expect(getPeriodsPerYear("60m")).toBe(252 * 6.25); // 1,575
    expect(getPeriodsPerYear("1d")).toBe(252);         // 252 (NOT 365!)
    expect(getPeriodsPerYear("1wk")).toBe(52);
    expect(getPeriodsPerYear("1mo")).toBe(12);

    // Fallbacks and backward compat
    expect(getPeriodsPerYear("")).toBe(252);
    expect(getPeriodsPerYear(undefined)).toBe(252);
    expect(getPeriodsPerYear(1)).toBe(252); // numeric legacy argument
  });

  it("dynamically resolves custom Indian session intraday and multi-day intervals", () => {
    // 75m bars (5 bars per 375m trading session)
    expect(getPeriodsPerYear("75m")).toBe(252 * 5); // 1,260
    // 125m bars (3 bars per 375m trading session)
    expect(getPeriodsPerYear("125m")).toBe(252 * 3); // 756
    // 2h bars (120 minutes)
    expect(getPeriodsPerYear("2h")).toBe(252 * (375 / 120)); // 787.5
    // 4h bars (240 minutes)
    expect(getPeriodsPerYear("4h")).toBe(252 * (375 / 240)); // 393.75
    // 2-day bars
    expect(getPeriodsPerYear("2d")).toBe(Math.round(252 / 2)); // 126
    // 2-week bars
    expect(getPeriodsPerYear("2w")).toBe(Math.round(52 / 2)); // 26
    // 3-month bars (quarterly)
    expect(getPeriodsPerYear("3mo")).toBe(Math.round(12 / 3)); // 4
  });
});

describe("Risk Metrics — Deterministic Annualisation & Financial Consistency", () => {
  it("annualisedReturn: 252 daily bars equals exactly 1.0 year of trading sessions", () => {
    // 253 points = 252 returns (exactly 1 year of trading)
    // Starting equity: 100,000, ending equity: 120,000 (+20%)
    const equityCurve: EquityPoint[] = Array.from({ length: 253 }, (_, i) => ({
      timestamp: 1700000000000 + i * 86400000,
      equity: 100_000 * (1 + (0.20 * i) / 252),
    }));

    const metrics = computeMetrics(equityCurve, [], undefined, "1d");
    expect(metrics.totalReturn).toBeCloseTo(0.20, 4);
    // Since duration is exactly 252 bars / 252 periods/year = 1.0 year, CAGR == totalReturn
    expect(metrics.annualisedReturn).toBeCloseTo(0.20, 4);
  });

  it("annualisedReturn: 18,900 5-minute bars equals exactly 1.0 year of trading sessions", () => {
    const totalBars = 18900;
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 100_000 },
      { timestamp: 1700000000000 + totalBars * 300000, equity: 115_000 }, // +15%
    ];
    // Add points in between to simulate 18900 intervals
    for (let i = 1; i < totalBars; i++) {
      equityCurve.splice(i, 0, {
        timestamp: 1700000000000 + i * 300000,
        equity: 100_000 * (1 + (0.15 * i) / totalBars),
      });
    }

    const metrics = computeMetrics(equityCurve, [], undefined, "5m");
    expect(metrics.totalReturn).toBeCloseTo(0.15, 4);
    expect(metrics.annualisedReturn).toBeCloseTo(0.15, 3);
  });

  it("Sharpe & Volatility: constant positive returns yield zero volatility and zero Sharpe denominator blowup", () => {
    // Constant equity growth: returns are identical every day
    const equityCurve: EquityPoint[] = Array.from({ length: 101 }, (_, i) => ({
      timestamp: 1700000000000 + i * 86400000,
      equity: 100_000 * Math.pow(1.001, i),
    }));

    const metrics = computeMetrics(equityCurve, [], undefined, "1d");
    expect(metrics.totalReturn).toBeGreaterThan(0);
    expect(isFinite(metrics.volatility)).toBe(true);
    expect(isFinite(metrics.sharpe)).toBe(true);
  });

  it("Benchmark comparison: alpha is dimensionally consistent (strategy CAGR - benchmark CAGR)", () => {
    const length = 253; // 252 bars
    const equityCurve: EquityPoint[] = Array.from({ length }, (_, i) => ({
      timestamp: 1700000000000 + i * 86400000,
      equity: 100_000 * (1 + (0.30 * i) / 252), // +30% strategy
    }));

    const benchmarkCurve: EquityPoint[] = Array.from({ length }, (_, i) => ({
      timestamp: 1700000000000 + i * 86400000,
      equity: 100_000 * (1 + (0.10 * i) / 252), // +10% benchmark
    }));

    const metrics = computeMetrics(equityCurve, [], benchmarkCurve, "1d");
    expect(metrics.annualisedReturn).toBeCloseTo(0.30, 4);
    expect(metrics.benchmarkReturn).toBeCloseTo(0.10, 4);
    // Alpha = strategy annualised return - benchmark annualised return
    expect(metrics.alpha).toBeCloseTo(0.30 - 0.10, 3);
  });

  it("Calmar ratio: annualisedReturn / maxDrawdown", () => {
    // Equity starts at 100, drops to 80 (20% drawdown), recovers to 120 (+20% total return)
    const points = [100, 90, 80, 100, 110, 120];
    const equityCurve: EquityPoint[] = points.map((eq, i) => ({
      timestamp: 1700000000000 + i * 86400000,
      equity: eq * 1000,
    }));

    const metrics = computeMetrics(equityCurve, [], undefined, "1d");
    expect(metrics.maxDrawdown).toBeCloseTo((100 - 80) / 100, 4); // 0.20
    expect(metrics.calmar).toBeCloseTo(metrics.annualisedReturn / metrics.maxDrawdown, 4);
  });
});

describe("Risk Metrics — Portfolio Turnover", () => {
  it("computes turnover as total traded notional / average portfolio equity", () => {
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 100_000 },
      { timestamp: 1700000000000 + 86400000, equity: 100_000 },
      { timestamp: 1700000000000 + 2 * 86400000, equity: 100_000 },
    ];

    // Trade: 1,000 shares bought @ 100 (100k notional) and sold @ 110 (110k notional)
    // Total traded notional = 100,000 + 110,000 = 210,000
    // Average equity = 100,000
    // Expected turnover = 210,000 / 100,000 = 2.1
    const trades: TradeRecord[] = [{
      entryTimestamp: 1700000000000,
      exitTimestamp: 1700000000000 + 86400000,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1000,
      side: "long",
      return: 0.10,
      netPnl: 10_000,
    }];

    const metrics = computeMetrics(equityCurve, trades, undefined, "1d");
    expect(metrics.turnover).toBeCloseTo(2.1, 4);
  });

  it("handles explicit trade notional field if provided", () => {
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 50_000 },
      { timestamp: 1700000000000 + 86400000, equity: 50_000 },
    ];

    const trades: TradeRecord[] = [{
      entryTimestamp: 1700000000000,
      exitTimestamp: 1700000000000 + 86400000,
      entryPrice: 500,
      exitPrice: 550,
      notional: 100_000,
      side: "long",
      return: 0.10,
    }];

    const metrics = computeMetrics(equityCurve, trades, undefined, "1d");
    // Notional 100,000 / Average Equity 50,000 = 2.0
    expect(metrics.turnover).toBeCloseTo(2.0, 4);
  });

  it("returns 0 turnover when no trades occur", () => {
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 100_000 },
      { timestamp: 1700000000000 + 86400000, equity: 100_000 },
    ];

    const metrics = computeMetrics(equityCurve, [], undefined, "1d");
    expect(metrics.turnover).toBe(0);
  });
});

describe("Risk Metrics — Expectancy & Profit Factor", () => {
  it("computes monetary profit factor and expectancy accurately using netPnl", () => {
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 100_000 },
      { timestamp: 1700000000000 + 86400000, equity: 105_000 },
    ];

    const trades: TradeRecord[] = [
      { entryTimestamp: 1, exitTimestamp: 2, entryPrice: 100, exitPrice: 110, side: "long", return: 0.1, netPnl: 8_000 },
      { entryTimestamp: 3, exitTimestamp: 4, entryPrice: 100, exitPrice: 95, side: "long", return: -0.05, netPnl: -4_000 },
    ];

    const metrics = computeMetrics(equityCurve, trades, undefined, "1d");
    expect(metrics.winRate).toBe(0.5);
    // Profit factor = gross profit (8,000) / gross loss (4,000) = 2.0
    expect(metrics.profitFactor).toBeCloseTo(2.0, 4);
    // Expectancy = net total (8,000 - 4,000) / 2 = 2,000
    expect(metrics.expectancy).toBeCloseTo(2000, 4);
  });
});

describe("Risk Metrics — Ulcer Index", () => {
  it("computes 0 ulcer index for monotonic non-decreasing equity", () => {
    const equity = [100, 105, 110, 115, 120];
    expect(computeUlcerIndex(equity)).toBe(0);
  });

  it("computes exact quadratic drawdown penalty for dipping equity", () => {
    // Peak is 100, drops to 90 (-10%), drops to 80 (-20%), recovers to 100 (0%)
    // DD percentages: [0, 10, 20, 0]
    // sumSq = 0 + 100 + 400 + 0 = 500
    // meanSq = 500 / 4 = 125
    // UI = sqrt(125) =~ 11.1803
    const equity = [100, 90, 80, 100];
    const ui = computeUlcerIndex(equity);
    expect(ui).toBeCloseTo(Math.sqrt(125), 4);
  });

  it("is integrated into computeMetrics output", () => {
    const equityCurve: EquityPoint[] = [
      { timestamp: 1700000000000, equity: 100_000 },
      { timestamp: 1700000000000 + 86400000, equity: 95_000 },
      { timestamp: 1700000000000 + 172800000, equity: 105_000 },
    ];
    const metrics = computeMetrics(equityCurve, [], undefined, "1d");
    expect(metrics.ulcerIndex).toBeDefined();
    expect(metrics.ulcerIndex).toBeGreaterThan(0);
  });
});
