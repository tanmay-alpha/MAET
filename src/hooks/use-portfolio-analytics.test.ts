import { describe, expect, it } from "bun:test";
import { tradeStatsFromFills } from "./use-portfolio-analytics";

const fill = (realizedPnl: string) => ({ realizedPnl });

describe("tradeStatsFromFills", () => {
  it("counts a buy then a profitable sell as one winning trade", () => {
    const stats = tradeStatsFromFills([fill("0.0000"), fill("250.0000")]);
    expect(stats.totalTrades).toBe(1);
    expect(stats.winningTrades).toBe(1);
    expect(stats.losingTrades).toBe(0);
    expect(stats.winRate).toBe(100);
    expect(stats.avgWin).toBe(250);
  });

  it("ignores opening and increasing fills when scoring wins and losses", () => {
    const stats = tradeStatsFromFills([
      fill("0.0000"), fill("0.0000"), fill("300.0000"),
      fill("0.0000"), fill("-100.0000"),
    ]);
    expect(stats.totalTrades).toBe(2);
    expect(stats.winRate).toBe(50);
    expect(stats.largestWin).toBe(300);
    expect(stats.largestLoss).toBe(-100);
    expect(stats.profitFactor).toBe(3);
  });

  it("reports no trades while only positions have been opened", () => {
    const stats = tradeStatsFromFills([fill("0.0000"), fill("0")]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
  });
});
