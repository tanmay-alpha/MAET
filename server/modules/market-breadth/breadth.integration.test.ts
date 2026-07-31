import { describe, expect, it } from "bun:test";
import { calculateMarketBreadth } from "./service";

describe("Market Breadth & Heatmap Integration Test Suite", () => {
  it("1. Returns real structural calculation object", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth).toHaveProperty("advances");
    expect(breadth).toHaveProperty("declines");
    expect(breadth).toHaveProperty("advanceDeclineRatio");
    expect(breadth).toHaveProperty("marketCapWeightedChange");
    expect(breadth).toHaveProperty("sectorContribution");
  });
});
