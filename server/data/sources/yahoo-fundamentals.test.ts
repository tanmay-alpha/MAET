import { describe, expect, it } from "bun:test";
import { parseYahooFundamentals } from "./yahoo-fundamentals";

const v = (raw: number) => ({ raw });

describe("parseYahooFundamentals", () => {
  it("normalizes verified snapshot fields and annual statements", () => {
    const parsed = parseYahooFundamentals("RELIANCE", { quoteSummary: { result: [{
      summaryDetail: { marketCap: v(20_000), dividendYield: v(0.004), fiftyTwoWeekHigh: v(1600), fiftyTwoWeekLow: v(1100) },
      defaultKeyStatistics: { trailingPE: v(25), priceToBook: v(2.5), trailingEps: v(50), bookValue: v(500) },
      financialData: { returnOnEquity: v(0.12), currentRatio: v(1.4) },
      incomeStatementHistory: { incomeStatementHistory: [{ endDate: v(1_735_603_200), totalRevenue: v(1000), netIncome: v(100) }] },
      balanceSheetHistory: { balanceSheetStatements: [{ endDate: v(1_735_603_200), totalAssets: v(5000), totalStockholderEquity: v(2000) }] },
      cashflowStatementHistory: { cashflowStatements: [{ endDate: v(1_735_603_200), totalCashFromOperatingActivities: v(300) }] },
    }] } });
    expect(parsed?.marketCap).toBe(20_000);
    expect(parsed?.trailingPe).toBe(25);
    expect(parsed?.statements).toHaveLength(1);
    expect(parsed?.statements[0].revenue).toBe(1000);
    expect(parsed?.statements[0].totalAssets).toBe(5000);
    expect(parsed?.statements[0].operatingCashFlow).toBe(300);
  });

  it("returns null for a Yahoo error payload", () => {
    expect(parseYahooFundamentals("TCS", { quoteSummary: { result: null, error: { code: "Unauthorized" } } })).toBeNull();
  });
});
