import type { Page } from "@playwright/test";
import type { DataQualityReport, SymbolQualityRow } from "../../../server/modules/data-quality/contracts";
import { API_ORIGIN } from "./mock-api";
import { FIXED_NOW } from "./data";

const PROCEDURE_PATH = "/api/trpc/dataQuality.getPublicReport";

function row(symbol: string, name: string, overrides: Partial<SymbolQualityRow> = {}): SymbolQualityRow {
  return {
    symbol,
    name,
    freshness: "fresh",
    latestCandleDate: "2026-11-05",
    sessionsBehind: 0,
    expectedSessions: 60,
    missingSessions: 0,
    invalidBars: 0,
    zeroVolumeBars: 0,
    invalidSamples: [],
    candleSource: "yahoo",
    lastQuoteAt: "2026-11-06T09:59:00.000Z",
    quoteSource: "yahoo",
    quoteDelayed: true,
    fundamentals: { latestPeriod: "2026-09-30", latestPeriodType: "quarterly", financialRows: 4, rowsMissingAvailability: 4 },
    corporateActions: { count: 0, latestExDate: null },
    ...overrides,
  };
}

/** A Nifty-style report with one symbol per state the page must label. */
export const DATA_QUALITY_REPORT: DataQualityReport = {
  asOf: FIXED_NOW,
  source: "database",
  universe: { id: "nifty50", label: "Nifty 50 (bundled constituent list)", symbolCount: 4, cap: 50 },
  calendar: {
    timezone: "Asia/Kolkata",
    latestCompletedSession: "2026-11-05",
    windowStart: "2026-08-10",
    windowSessions: 60,
    holidaysConfigured: 20,
  },
  summary: {
    symbols: 4,
    withDailyCandles: 3,
    coveragePct: 75,
    fresh: 2,
    stale: 1,
    missing: 1,
    invalidBars: 2,
    symbolsWithInvalidBars: 1,
    zeroVolumeBars: 1,
    missingSessions: 66,
    expectedSessions: 240,
    quotesCovered: 3,
    lastQuote: { at: "2026-11-06T09:59:00.000Z", source: "yahoo", delayed: true },
    fundamentalsCovered: 3,
    fundamentalsMissingAvailability: 12,
    corporateActionsCovered: 0,
  },
  symbols: [
    row("TCS", "Tata Consultancy Services"),
    row("RELIANCE", "Reliance Industries", {
      invalidBars: 2,
      zeroVolumeBars: 1,
      invalidSamples: [{ date: "2026-10-30", issues: ["high_below_low", "close_outside_range"] }],
    }),
    row("INFY", "Infosys", { freshness: "stale", latestCandleDate: "2026-10-30", sessionsBehind: 4, missingSessions: 6 }),
    row("WIPRO", "Wipro", {
      freshness: "missing",
      latestCandleDate: null,
      sessionsBehind: null,
      missingSessions: 60,
      candleSource: null,
      lastQuoteAt: null,
      quoteSource: null,
      quoteDelayed: null,
      fundamentals: { latestPeriod: null, latestPeriodType: null, financialRows: 0, rowsMissingAvailability: 0 },
    }),
  ],
  pipelineGaps: [
    {
      id: "price_daily_not_consumed",
      severity: "critical",
      title: "Ingestion engine writes price_daily; consumers read candles",
      detail: "price_daily holds daily bars up to 2026-11-06, but charts, the screener and backtests read the candles table (latest 1d bar 2026-11-05).",
    },
    {
      id: "fundamentals_missing_availability",
      severity: "warning",
      title: "Fundamentals lack filing and availability dates",
      detail: "12 of 12 quarterly/annual fundamentals rows have no filing_date (12) or available_from (12).",
    },
    {
      id: "corporate_actions_empty",
      severity: "warning",
      title: "corporate_actions is empty",
      detail: "No splits, bonuses or dividends are stored.",
    },
  ],
};

export interface DataQualityMock {
  /** Requests answered so far. */
  calls: number;
  /** While true, every request fails with INTERNAL_SERVER_ERROR. */
  failing: boolean;
  report: DataQualityReport;
}

/**
 * Answers the public dataQuality.getPublicReport procedure. Registered after MockApi.install,
 * so Playwright consults it first; the procedure is public and needs no Bearer token.
 */
export async function mockDataQualityReport(page: Page): Promise<DataQualityMock> {
  const mock: DataQualityMock = { calls: 0, failing: false, report: structuredClone(DATA_QUALITY_REPORT) };
  await page.route(
    (url) => url.origin === API_ORIGIN && url.pathname === PROCEDURE_PATH,
    async (route) => {
      mock.calls++;
      if (mock.failing) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Internal server error", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "dataQuality.getPublicReport" } },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { data: mock.report } }) });
    },
  );
  return mock;
}
