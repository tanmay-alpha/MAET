import { describe, expect, it } from "bun:test";
import { ratioMetric } from "./-backtest-metrics";

describe("backtest ratio metrics", () => {
  it("shows an undefined ratio (no losing trades) as a neutral dash, not 0.00", () => {
    // The API returns null when there are no losses; older deployments sent Infinity, which JSON also turns into null.
    expect(ratioMetric("Profit Factor", null)).toEqual({ label: "Profit Factor", value: "—", trend: 0, hint: "No losing trades" });
    expect(ratioMetric("Payoff Ratio", undefined).value).toBe("—");
  });

  it("formats a defined ratio and trends it against 1", () => {
    expect(ratioMetric("Profit Factor", 1.5)).toEqual({ label: "Profit Factor", value: "1.50", trend: 0.5 });
    expect(ratioMetric("Profit Factor", 0).trend).toBe(-1);
  });
});
