import { describe, expect, it } from "bun:test";
import { parseYahooFundamentals, parseYahooTimeseriesFundamentals } from "./yahoo-fundamentals";

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

  it("normalizes the public fundamentals-timeseries fallback", () => {
    const series = (type: string, values: Array<[string, number]>) => ({
      meta: { type: [type] },
      [type]: values.map(([asOfDate, value]) => ({ asOfDate, currencyCode: "INR", reportedValue: v(value) })),
    });
    const quarters: Array<[string, number]> = [
      ["2025-06-30", 20], ["2025-09-30", 25], ["2025-12-31", 30], ["2026-03-31", 35],
    ];
    const parsed = parseYahooTimeseriesFundamentals("RELIANCE", { timeseries: { result: [
      series("trailingMarketCap", [["2026-07-02", 2_000]]),
      series("trailingPeRatio", [["2026-07-02", 20]]),
      series("trailingPbRatio", [["2026-07-02", 2.5]]),
      series("quarterlyNetIncome", quarters),
      series("quarterlyDilutedAverageShares", quarters.map(([date]) => [date, 10])),
      series("annualStockholdersEquity", [["2026-03-31", 500]]),
      series("annualTotalDebt", [["2026-03-31", 100]]),
      series("annualCurrentAssets", [["2026-03-31", 300]]),
      series("annualCurrentLiabilities", [["2026-03-31", 150]]),
      series("annualOperatingCashFlow", [["2026-03-31", 75]]),
    ] } }, { fiftyTwoWeekHigh: v(1600), fiftyTwoWeekLow: v(1100) });

    expect(parsed?.source).toBe("yahoo_timeseries");
    expect(parsed?.marketCap).toBe(2_000);
    expect(parsed?.epsTtm).toBe(11);
    expect(parsed?.bookValuePerShare).toBe(50);
    expect(parsed?.roe).toBeCloseTo(0.22);
    expect(parsed?.debtToEquity).toBe(0.2);
    expect(parsed?.currentRatio).toBe(2);
    expect(parsed?.statements.some((statement) => statement.operatingCashFlow === 75)).toBeTrue();
    expect(parsed?.fiftyTwoWeekHigh).toBe(1600);
  });
});
