import { describe, expect, it } from "bun:test";
import { computeMetrics } from "../../domain/backtest/risk-metrics";
import { computePortfolioMetrics, type EquitySnapshotPoint } from "./portfolio-metrics";

function series(values: Array<[string, number]>, stale: string[] = [], provisional: string[] = []): EquitySnapshotPoint[] {
  return values.map(([date, equity]) => ({
    date,
    equity,
    stalePrices: stale.includes(date),
    isFinal: !provisional.includes(date),
  }));
}

function sampleStd(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

// Equity 100 -> 110 -> 99 -> 105 over four trading days.
// Daily returns: +10%, -10%, +6/99 (= 105/99 - 1).
const KNOWN = series([
  ["2026-10-05", 100],
  ["2026-10-06", 110],
  ["2026-10-07", 99],
  ["2026-10-08", 105],
]);
const R = [0.1, -0.1, 6 / 99];
const MEAN = (0.1 - 0.1 + 6 / 99) / 3; // 2/99
const SAMPLE_STD = Math.sqrt(R.reduce((sum, r) => sum + (r - MEAN) ** 2, 0) / (R.length - 1));

describe("computePortfolioMetrics", () => {
  it("returns null metrics with a reason when there are fewer than 2 snapshots", () => {
    for (const points of [[], series([["2026-10-05", 100]])]) {
      const metrics = computePortfolioMetrics(points);
      expect(metrics.snapshotCount).toBe(points.length);
      expect(metrics.dailyReturnsCount).toBe(0);
      for (const metric of [metrics.totalReturn, metrics.cagr, metrics.volatility, metrics.sharpe, metrics.maxDrawdown]) {
        expect(metric.value).toBeNull();
        expect(metric.reason).toContain("at least 2 daily snapshots");
      }
    }
  });

  it("computes total return, volatility, Sharpe and drawdown dates on a hand-computed series", () => {
    const metrics = computePortfolioMetrics(KNOWN);

    expect(metrics.snapshotCount).toBe(4);
    expect(metrics.dailyReturnsCount).toBe(3);
    expect(metrics.firstDate).toBe("2026-10-05");
    expect(metrics.lastDate).toBe("2026-10-08");
    expect(metrics.totalReturn.value).toBeCloseTo(0.05, 12);

    // Sample std x sqrt(252): 0.10594510 x 15.87450787 = 1.68182637
    expect(SAMPLE_STD).toBeCloseTo(0.1059451030521397, 12);
    expect(metrics.volatility.value).toBeCloseTo(1.6818263718064306, 10);
    // rf = 0: mean / std x sqrt(252) = (2/99) / 0.10594510 x 15.87450787 = 3.02701229
    expect(metrics.sharpe.value).toBeCloseTo(3.0270122863164577, 10);

    // Peak 110 on 10-06, trough 99 on 10-07: (110 - 99) / 110 = 10%; not yet recovered.
    expect(metrics.maxDrawdown.value).toBeCloseTo(0.1, 12);
    expect(metrics.maxDrawdown.peakDate).toBe("2026-10-06");
    expect(metrics.maxDrawdown.troughDate).toBe("2026-10-07");
    expect(metrics.maxDrawdown.recoveryDate).toBeNull();

    expect(metrics.cagr.value).toBeNull();
    expect(metrics.cagr.reason).toContain("one year");
  });

  it("converts a configurable annual risk-free rate to a daily rate, as backtests do", () => {
    const metrics = computePortfolioMetrics(KNOWN, { riskFreeRate: 0.05 });
    const dailyRf = 1.05 ** (1 / 252) - 1; // 0.000193630
    const expected = ((MEAN - dailyRf) / SAMPLE_STD) * Math.sqrt(252); // 2.99799925
    expect(metrics.riskFreeRate).toBe(0.05);
    expect(metrics.sharpe.value).toBeCloseTo(expected, 10);
    expect(metrics.sharpe.value).toBeCloseTo(2.9979992511619002, 10);
    // Volatility does not depend on the risk-free rate.
    expect(metrics.volatility.value).toBeCloseTo(1.6818263718064306, 10);
  });

  it("records the recovery date once equity regains the drawdown's peak", () => {
    const metrics = computePortfolioMetrics(
      series([
        ["2026-10-05", 200],
        ["2026-10-06", 150],
        ["2026-10-07", 180],
        ["2026-10-08", 210],
        ["2026-10-09", 189],
      ])
    );
    // Deepest fall is 200 -> 150 (25%), recovered on 10-08; 210 -> 189 is only 10%.
    expect(metrics.maxDrawdown.value).toBeCloseTo(0.25, 12);
    expect(metrics.maxDrawdown.peakDate).toBe("2026-10-05");
    expect(metrics.maxDrawdown.troughDate).toBe("2026-10-06");
    expect(metrics.maxDrawdown.recoveryDate).toBe("2026-10-08");
  });

  it("reports zero drawdown without dates for a rising curve", () => {
    const metrics = computePortfolioMetrics(series([["2026-10-05", 100], ["2026-10-06", 101], ["2026-10-07", 102]]));
    expect(metrics.maxDrawdown.value).toBe(0);
    expect(metrics.maxDrawdown.peakDate).toBeNull();
    expect(metrics.maxDrawdown.troughDate).toBeNull();
  });

  it("needs two daily returns for volatility and Sharpe", () => {
    const metrics = computePortfolioMetrics(series([["2026-10-05", 100], ["2026-10-06", 102]]));
    expect(metrics.totalReturn.value).toBeCloseTo(0.02, 12);
    expect(metrics.dailyReturnsCount).toBe(1);
    expect(metrics.volatility.value).toBeNull();
    expect(metrics.volatility.reason).toContain("at least 2 consecutive-session daily returns");
    expect(metrics.sharpe.value).toBeNull();
  });

  it("does not report a Sharpe ratio for a curve with zero volatility", () => {
    const metrics = computePortfolioMetrics(series([["2026-10-05", 100], ["2026-10-06", 100], ["2026-10-07", 100]]));
    expect(metrics.volatility.value).toBe(0);
    expect(metrics.sharpe.value).toBeNull();
    expect(metrics.sharpe.reason).toContain("zero volatility");
  });

  it("annualises CAGR over calendar days once the curve spans a year", () => {
    // 100 -> 121 over 730 days: (1.21)^(365/730) - 1 = 1.1 - 1 = 10%.
    const metrics = computePortfolioMetrics(series([["2024-01-01", 100], ["2024-12-31", 110], ["2025-12-31", 121]]));
    expect(metrics.calendarDays).toBe(730);
    expect(metrics.cagr.value).toBeCloseTo(0.1, 12);
    expect(metrics.cagr.reason).toBeNull();
  });

  it("counts snapshots valued with stale prices", () => {
    const metrics = computePortfolioMetrics(series([["2026-10-05", 100], ["2026-10-06", 101]], ["2026-10-06"]));
    expect(metrics.staleSnapshotCount).toBe(1);
  });

  it("sorts unsorted input by date", () => {
    const metrics = computePortfolioMetrics([...KNOWN].reverse());
    expect(metrics.firstDate).toBe("2026-10-05");
    expect(metrics.totalReturn.value).toBeCloseTo(0.05, 12);
  });

  it("matches the backtest risk-metrics definitions on a gapless curve", () => {
    const backtest = computeMetrics(
      KNOWN.map((point, i) => ({ timestamp: i * 86_400_000, equity: point.equity })),
      [],
      undefined,
      "1d",
      { riskFreeRate: 0.065 }
    );
    const metrics = computePortfolioMetrics(KNOWN, { riskFreeRate: 0.065 });
    expect(metrics.volatility.value).toBeCloseTo(backtest.volatility, 12);
    expect(metrics.sharpe.value).toBeCloseTo(backtest.sharpe, 12);
    expect(metrics.sharpe.value).toBeCloseTo(2.98956, 4);
  });

  describe("gaps (missed trading sessions)", () => {
    // Wed 10-07 -> Mon 10-12 skips Thu 10-08 and Fri 10-09: one return spanning 3 sessions.
    const GAPPED = series([
      ["2026-10-05", 100],
      ["2026-10-06", 110],
      ["2026-10-07", 99],
      ["2026-10-12", 105],
      ["2026-10-13", 102.9],
    ]);

    it("counts missed sessions and uses only consecutive-session returns for volatility and Sharpe", () => {
      const metrics = computePortfolioMetrics(GAPPED);
      expect(metrics.gapCount).toBe(2);
      // 10-07 -> 10-12 is excluded; the rest are +10%, -10%, 102.9/105 - 1 = -2%.
      const consecutive = [0.1, -0.1, -0.02];
      expect(metrics.dailyReturnsCount).toBe(3);
      expect(metrics.volatility.value).toBeCloseTo(sampleStd(consecutive) * Math.sqrt(252), 10);
      const mean = (0.1 - 0.1 - 0.02) / 3;
      expect(metrics.sharpe.value).toBeCloseTo((mean / sampleStd(consecutive)) * Math.sqrt(252), 10);
      // Total return and drawdown still use the whole curve.
      expect(metrics.totalReturn.value).toBeCloseTo(0.029, 12);
      expect(metrics.maxDrawdown.value).toBeCloseTo(0.1, 12);
    });

    it("counts sessions with the supplied trading calendar", () => {
      // With Thu 10-08 a holiday, 10-07 -> 10-12 misses only Fri 10-09.
      const holidays = new Set(["2026-10-08"]);
      const sessionsBetween = (from: string, to: string) => {
        let count = 0;
        for (let t = Date.parse(`${from}T00:00:00Z`) + 86_400_000; t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
          const date = new Date(t);
          if (date.getUTCDay() % 6 !== 0 && !holidays.has(date.toISOString().slice(0, 10))) count++;
        }
        return count;
      };
      expect(computePortfolioMetrics(GAPPED, { sessionsBetween }).gapCount).toBe(1);
    });

    it("returns null volatility with a reason when gaps leave fewer than 2 consecutive returns", () => {
      const metrics = computePortfolioMetrics(series([["2026-10-05", 100], ["2026-10-08", 104], ["2026-10-13", 101]]));
      expect(metrics.gapCount).toBe(4);
      expect(metrics.dailyReturnsCount).toBe(0);
      expect(metrics.volatility.value).toBeNull();
      expect(metrics.volatility.reason).toContain("consecutive-session");
      expect(metrics.volatility.reason).toContain("4 missed sessions");
      expect(metrics.sharpe.value).toBeNull();
      expect(metrics.totalReturn.value).toBeCloseTo(0.01, 12);
    });
  });

  describe("generation-start anchor", () => {
    it("measures total return from the generation's initial cash", () => {
      // Day-one trading: the first close is already above the starting cash.
      const metrics = computePortfolioMetrics(
        series([["2026-10-05", 1_009_831], ["2026-10-06", 1_009_831]]),
        { anchor: { date: "2026-10-05", equity: 1_000_000 } }
      );
      expect(metrics.firstDate).toBe("2026-10-05");
      expect(metrics.totalReturn.value).toBeCloseTo(0.009831, 12);
      // Start -> 10-05 close is the first session's return; 10-05 -> 10-06 the second.
      expect(metrics.dailyReturnsCount).toBe(2);
      expect(metrics.gapCount).toBe(0);
      expect(metrics.volatility.value).toBeCloseTo(sampleStd([0.009831, 0]) * Math.sqrt(252), 10);
    });

    it("reports total return from one snapshot after the start", () => {
      const metrics = computePortfolioMetrics(series([["2026-10-05", 105]]), { anchor: { date: "2026-10-03", equity: 100 } });
      // Started on Saturday 10-03; Monday 10-05 is the first session, so no gap.
      expect(metrics.totalReturn.value).toBeCloseTo(0.05, 12);
      expect(metrics.gapCount).toBe(0);
      expect(metrics.snapshotCount).toBe(1);
      expect(metrics.volatility.value).toBeNull();
    });

    it("still needs a snapshot after the start", () => {
      const metrics = computePortfolioMetrics([], { anchor: { date: "2026-10-05", equity: 100 } });
      expect(metrics.totalReturn.value).toBeNull();
      expect(metrics.totalReturn.reason).toContain("Insufficient history");
    });

    it("dates a drawdown from the starting cash", () => {
      const metrics = computePortfolioMetrics(series([["2026-10-05", 90], ["2026-10-06", 95]]), {
        anchor: { date: "2026-10-05", equity: 100 },
      });
      expect(metrics.maxDrawdown.value).toBeCloseTo(0.1, 12);
      expect(metrics.maxDrawdown.peakDate).toBe("2026-10-05");
      expect(metrics.maxDrawdown.troughDate).toBe("2026-10-05");
    });
  });

  it("counts past provisional snapshots that never got a closing value", () => {
    const points = series([["2026-10-05", 100], ["2026-10-06", 101], ["2026-10-07", 102]], [], ["2026-10-05", "2026-10-07"]);
    // Today's (10-07) intraday point is expected to be provisional; 10-05 never got its close.
    expect(computePortfolioMetrics(points, { currentSessionDate: "2026-10-07" }).provisionalSnapshotCount).toBe(1);
    expect(computePortfolioMetrics(points, { currentSessionDate: "2026-10-08" }).provisionalSnapshotCount).toBe(2);
  });
});
