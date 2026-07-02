import { describe, expect, test } from "bun:test";
import { calculateFundamentalRatios } from "./ratios";

describe("fundamental ratio engine", () => {
  test("calculates profitability, growth, liquidity, cash flow and valuation ratios", () => {
    const ratios = calculateFundamentalRatios({
      revenue: 1_200,
      costOfRevenue: 720,
      operatingIncome: 240,
      ebitda: 300,
      ebit: 220,
      interestExpense: 20,
      taxExpense: 44,
      netIncome: 150,
      totalAssets: 1_100,
      currentAssets: 400,
      inventory: 100,
      currentLiabilities: 200,
      totalDebt: 250,
      cashAndEquivalents: 50,
      shareholdersEquity: 500,
      operatingCashFlow: 210,
      capitalExpenditure: -60,
      dividendsPaid: -30,
      sharesOutstanding: 100,
    }, {
      revenue: 1_000,
      netIncome: 120,
      totalAssets: 900,
      shareholdersEquity: 400,
      sharesOutstanding: 100,
    }, { price: 15, marketCap: 1_500, enterpriseValue: 1_700 });

    expect(ratios.grossMargin).toBeCloseTo(0.4);
    expect(ratios.roe).toBeCloseTo(1 / 3);
    expect(ratios.revenueGrowth).toBeCloseTo(0.2);
    expect(ratios.currentRatio).toBe(2);
    expect(ratios.quickRatio).toBe(1.5);
    expect(ratios.freeCashFlow).toBe(150);
    expect(ratios.peRatio).toBe(10);
    expect(ratios.enterpriseValueToEbitda).toBeCloseTo(17 / 3);
  });

  test("does not emit infinities when a denominator is zero", () => {
    const ratios = calculateFundamentalRatios({ revenue: 0, netIncome: 20, sharesOutstanding: 0 });
    expect(ratios.netMargin).toBeUndefined();
    expect(ratios.eps).toBeUndefined();
    expect(ratios.peRatio).toBeUndefined();
  });
});
