import { describe, expect, it } from "bun:test";
import type { PortfolioAnalyticsResult } from "../../server/modules/paper-trading/portfolio-analytics-contracts";
import { curveToHistory, dateSpacedX } from "./portfolio-curve";

function point(date: string, equity: number, overrides: { stalePrices?: boolean; isFinal?: boolean } = {}) {
  return {
    date,
    equity,
    cash: equity,
    positionsMarketValue: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesToDate: 0,
    positionsCount: 0,
    stalePrices: overrides.stalePrices ?? false,
    priceSource: "none",
    isFinal: overrides.isFinal ?? true,
    capturedAt: `${date}T10:30:00.000Z`,
  };
}

describe("curveToHistory", () => {
  it("starts the chart at the generation's initial cash and flags stale and provisional points", () => {
    const performance = {
      account: { generation: 1, initialCash: 1_000_000, status: "ACTIVE" },
      anchor: { date: "2026-10-05", equity: 1_000_000 },
      curve: [point("2026-10-05", 1_009_831), point("2026-10-06", 1_005_000, { stalePrices: true, isFinal: false })],
    } as unknown as PortfolioAnalyticsResult;

    expect(curveToHistory(performance)).toEqual([
      { date: "2026-10-05", value: 1_000_000, pnl: 0, anchor: true },
      { date: "2026-10-05", value: 1_009_831, pnl: 9_831, stale: false, provisional: false },
      { date: "2026-10-06", value: 1_005_000, pnl: 5_000, stale: true, provisional: true },
    ]);
  });

  it("is empty without an account", () => {
    expect(curveToHistory(undefined)).toEqual([]);
  });
});

describe("dateSpacedX", () => {
  it("spaces points by calendar date so gaps are visible", () => {
    // 10-05, 10-06, then a gap to 10-15: 10 days across 100px.
    expect(dateSpacedX(["2026-10-05", "2026-10-06", "2026-10-15"], 20, 100)).toEqual([20, 30, 120]);
  });

  it("puts points sharing a date, or a single date, at the left edge", () => {
    expect(dateSpacedX(["2026-10-05", "2026-10-05"], 20, 100)).toEqual([20, 20]);
  });
});
