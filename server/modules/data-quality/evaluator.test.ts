import { describe, expect, it } from "bun:test";
import { parseNseHolidays } from "../../config";
import type { SymbolQualityRow } from "./contracts";
import {
  barIssues,
  classifyFreshness,
  detectPipelineGaps,
  evaluateCoverage,
  isDelayedQuoteSource,
  isInvalidBar,
  isNseTradingDate,
  latestCompletedSession,
  recentSessions,
  sessionsBetween,
  summarize,
  type StructuralProbe,
} from "./evaluator";

// Bundled NSE calendar: 2026-10-20 (Tue), 2026-11-08 (Sun), 2026-11-10 (Tue) are holidays.
const HOLIDAYS = parseNseHolidays(undefined);
const ist = (local: string) => new Date(`${local}+05:30`);

describe("NSE session calendar", () => {
  it("treats weekends and listed holidays as non-trading days", () => {
    expect(isNseTradingDate("2026-11-06", HOLIDAYS)).toBe(true); // Friday
    expect(isNseTradingDate("2026-11-07", HOLIDAYS)).toBe(false); // Saturday
    expect(isNseTradingDate("2026-11-08", HOLIDAYS)).toBe(false); // Sunday
    expect(isNseTradingDate("2026-11-10", HOLIDAYS)).toBe(false); // holiday
    expect(isNseTradingDate("2026-11-10", [])).toBe(true);
  });

  it("uses the previous session until today's 15:30 IST close", () => {
    // Thursday 2026-11-05.
    expect(latestCompletedSession(ist("2026-11-05T00:00:00"), HOLIDAYS)).toBe("2026-11-04");
    expect(latestCompletedSession(ist("2026-11-05T09:15:00"), HOLIDAYS)).toBe("2026-11-04");
    expect(latestCompletedSession(ist("2026-11-05T15:29:59"), HOLIDAYS)).toBe("2026-11-04");
    expect(latestCompletedSession(ist("2026-11-05T15:30:00"), HOLIDAYS)).toBe("2026-11-05");
    expect(latestCompletedSession(ist("2026-11-05T23:59:59"), HOLIDAYS)).toBe("2026-11-05");
  });

  it("reads the IST date, not the UTC date, near midnight", () => {
    // 2026-11-05 19:00 UTC is already Friday 00:30 IST: Thursday's session is the latest closed one.
    expect(latestCompletedSession(new Date("2026-11-05T19:00:00Z"), HOLIDAYS)).toBe("2026-11-05");
    // 2026-11-05 09:59 UTC is Thursday 15:29 IST: Thursday has not closed yet.
    expect(latestCompletedSession(new Date("2026-11-05T09:59:00Z"), HOLIDAYS)).toBe("2026-11-04");
    // 10:00 UTC is 15:30 IST.
    expect(latestCompletedSession(new Date("2026-11-05T10:00:00Z"), HOLIDAYS)).toBe("2026-11-05");
  });

  it("skips weekends and holidays back to the last trading day", () => {
    // Monday 2026-11-09 before the close → Friday 2026-11-06.
    expect(latestCompletedSession(ist("2026-11-09T10:00:00"), HOLIDAYS)).toBe("2026-11-06");
    // Saturday and Sunday → Friday.
    expect(latestCompletedSession(ist("2026-11-07T18:00:00"), HOLIDAYS)).toBe("2026-11-06");
    expect(latestCompletedSession(ist("2026-11-08T18:00:00"), HOLIDAYS)).toBe("2026-11-06");
    // Holiday Tuesday 2026-11-10 after 15:30 → Monday 2026-11-09.
    expect(latestCompletedSession(ist("2026-11-10T18:00:00"), HOLIDAYS)).toBe("2026-11-09");
    // Wednesday 2026-11-11 morning → Monday, across the holiday.
    expect(latestCompletedSession(ist("2026-11-11T09:00:00"), HOLIDAYS)).toBe("2026-11-09");
  });

  it("lists the last N sessions oldest first without weekends or holidays", () => {
    expect(recentSessions("2026-11-11", 5, HOLIDAYS)).toEqual([
      "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-11",
    ]);
    // A non-trading end date is not included.
    expect(recentSessions("2026-11-10", 2, HOLIDAYS)).toEqual(["2026-11-06", "2026-11-09"]);
    const sixty = recentSessions("2026-11-09", 60, HOLIDAYS);
    expect(sixty).toHaveLength(60);
    expect(sixty).not.toContain("2026-10-20");
    expect(sixty.every((date) => isNseTradingDate(date, HOLIDAYS))).toBe(true);
  });

  it("counts sessions between two dates, exclusive of the start", () => {
    expect(sessionsBetween("2026-11-06", "2026-11-06", HOLIDAYS)).toBe(0);
    expect(sessionsBetween("2026-11-06", "2026-11-09", HOLIDAYS)).toBe(1); // weekend skipped
    expect(sessionsBetween("2026-11-06", "2026-11-11", HOLIDAYS)).toBe(2); // holiday skipped
    expect(sessionsBetween("2026-11-12", "2026-11-11", HOLIDAYS)).toBe(0); // bar newer than the session
  });
});

describe("bar checks", () => {
  const good = { open: 100, high: 105, low: 95, close: 102, volume: 1_000 };

  it("accepts a well-formed bar", () => {
    expect(barIssues(good)).toEqual([]);
  });

  it("flags inverted ranges and opens/closes outside the range", () => {
    expect(barIssues({ ...good, high: 90, low: 95, open: 92, close: 93 })).toEqual([
      "high_below_low", "open_outside_range", "close_outside_range",
    ]);
    expect(barIssues({ ...good, open: 106 })).toEqual(["open_outside_range"]);
    expect(barIssues({ ...good, close: 94 })).toEqual(["close_outside_range"]);
    // Touching the range bounds is valid.
    expect(barIssues({ ...good, open: 95, close: 105 })).toEqual([]);
  });

  it("flags non-positive and missing prices", () => {
    expect(barIssues({ ...good, low: 0, open: 0 })).toContain("non_positive_price");
    expect(barIssues({ ...good, close: -1 })).toContain("non_positive_price");
    expect(barIssues({ ...good, close: null })).toEqual(["non_positive_price"]);
  });

  it("separates negative, missing and zero volume", () => {
    expect(barIssues({ ...good, volume: -5 })).toEqual(["negative_volume"]);
    expect(barIssues({ ...good, volume: null })).toEqual(["missing_volume"]);
    expect(barIssues({ ...good, volume: Number.NaN })).toEqual(["missing_volume"]);
    expect(barIssues({ ...good, volume: 0 })).toEqual(["zero_volume"]);
  });

  it("treats zero volume as a warning and everything else as invalid", () => {
    expect(isInvalidBar(["zero_volume"])).toBe(false);
    expect(isInvalidBar(["negative_volume"])).toBe(true);
    expect(isInvalidBar(["missing_volume"])).toBe(true);
    expect(isInvalidBar(["high_below_low", "zero_volume"])).toBe(true);
  });
});

describe("freshness", () => {
  const windowSessions = recentSessions("2026-11-09", 10, HOLIDAYS);
  const calendar = { latestCompletedSession: "2026-11-09", windowSessions, holidays: HOLIDAYS };

  it("is fresh up to one session behind and stale beyond", () => {
    expect(classifyFreshness(0)).toBe("fresh");
    expect(classifyFreshness(1)).toBe("fresh");
    expect(classifyFreshness(2)).toBe("stale");
    expect(classifyFreshness(null)).toBe("missing");
  });

  it("measures lag in sessions, not calendar days", () => {
    // Friday's bar on Monday evening: one session (Monday) behind, the weekend does not count.
    const friday = evaluateCoverage({ firstDate: windowSessions[0]!, latestDate: "2026-11-06", presentSessions: 9 }, calendar);
    expect(friday).toEqual({ freshness: "fresh", sessionsBehind: 1, expectedSessions: 10, missingSessions: 1 });
    const thursday = evaluateCoverage({ firstDate: windowSessions[0]!, latestDate: "2026-11-05", presentSessions: 8 }, calendar);
    expect(thursday.freshness).toBe("stale");
    expect(thursday.sessionsBehind).toBe(2);
  });

  it("counts holes inside the window but not sessions before the first stored bar", () => {
    const listedLate = evaluateCoverage({ firstDate: windowSessions[6]!, latestDate: "2026-11-09", presentSessions: 3 }, calendar);
    expect(listedLate.expectedSessions).toBe(4);
    expect(listedLate.missingSessions).toBe(1);
    // History older than the window: every window session is expected.
    const old = evaluateCoverage({ firstDate: "2020-01-01", latestDate: "2026-11-09", presentSessions: 7 }, calendar);
    expect(old).toEqual({ freshness: "fresh", sessionsBehind: 0, expectedSessions: 10, missingSessions: 3 });
  });

  it("reports a symbol without bars as missing every window session", () => {
    expect(evaluateCoverage({ firstDate: null, latestDate: null, presentSessions: 0 }, calendar)).toEqual({
      freshness: "missing", sessionsBehind: null, expectedSessions: 10, missingSessions: 10,
    });
  });
});

describe("quotes", () => {
  it("treats only Angel One as a real-time source", () => {
    expect(isDelayedQuoteSource("angelone")).toBe(false);
    expect(isDelayedQuoteSource("yahoo")).toBe(true);
    expect(isDelayedQuoteSource("nse")).toBe(true);
    expect(isDelayedQuoteSource("constructor")).toBe(true);
  });
});

function row(overrides: Partial<SymbolQualityRow>): SymbolQualityRow {
  return {
    symbol: "X",
    name: null,
    freshness: "fresh",
    latestCandleDate: "2026-11-09",
    sessionsBehind: 0,
    expectedSessions: 60,
    missingSessions: 0,
    invalidBars: 0,
    zeroVolumeBars: 0,
    invalidSamples: [],
    candleSource: "yahoo",
    lastQuoteAt: null,
    quoteSource: null,
    quoteDelayed: null,
    fundamentals: { latestPeriod: null, latestPeriodType: null, financialRows: 0, rowsMissingAvailability: 0 },
    corporateActions: { count: 0, latestExDate: null },
    ...overrides,
  };
}

describe("summary", () => {
  it("aggregates freshness, bars, quotes and coverage", () => {
    const summary = summarize([
      row({ symbol: "A", invalidBars: 2, zeroVolumeBars: 1, missingSessions: 3, lastQuoteAt: "2026-11-09T09:00:00.000Z", quoteSource: "yahoo", quoteDelayed: true }),
      row({ symbol: "B", freshness: "stale", sessionsBehind: 4, lastQuoteAt: "2026-11-09T10:00:00.000Z", quoteSource: "angelone", quoteDelayed: false, fundamentals: { latestPeriod: "2026-09-30", latestPeriodType: "quarterly", financialRows: 4, rowsMissingAvailability: 4 } }),
      row({ symbol: "C", freshness: "missing", latestCandleDate: null, sessionsBehind: null, missingSessions: 60, corporateActions: { count: 2, latestExDate: "2026-08-01" } }),
    ]);
    expect(summary).toMatchObject({
      symbols: 3, withDailyCandles: 2, coveragePct: 66.7, fresh: 1, stale: 1, missing: 1,
      invalidBars: 2, symbolsWithInvalidBars: 1, zeroVolumeBars: 1, missingSessions: 63, expectedSessions: 180,
      quotesCovered: 2, fundamentalsCovered: 1, fundamentalsMissingAvailability: 4, corporateActionsCovered: 1,
    });
    expect(summary.lastQuote).toEqual({ at: "2026-11-09T10:00:00.000Z", source: "angelone", delayed: false });
  });

  it("handles an empty universe", () => {
    expect(summarize([])).toMatchObject({ symbols: 0, coveragePct: 0, lastQuote: null });
  });
});

describe("pipeline gaps", () => {
  const healthy: StructuralProbe = {
    priceDaily: { hasRows: false, latestDate: null },
    dailyCandles: { hasRows: true, latestDate: "2026-11-09" },
    fundamentals: { financialRows: 10, missingFilingDate: 0, missingAvailableFrom: 0 },
    corporateActionsHasRows: true,
    universeMembershipHasRows: true,
    quoteSnapshotsHasRows: true,
  };

  it("reports nothing for a healthy pipeline", () => {
    expect(detectPipelineGaps(healthy)).toEqual([]);
    expect(detectPipelineGaps({ ...healthy, priceDaily: null })).toEqual([]);
  });

  it("flags price_daily bars newer than any candle as critical", () => {
    const gaps = detectPipelineGaps({ ...healthy, priceDaily: { hasRows: true, latestDate: "2026-11-10" } });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ id: "price_daily_not_consumed", severity: "critical" });
    expect(gaps[0]!.detail).toContain("2026-11-10");
    const inSync = detectPipelineGaps({ ...healthy, priceDaily: { hasRows: true, latestDate: "2026-11-09" } });
    expect(inSync[0]).toMatchObject({ id: "price_daily_not_consumed", severity: "warning" });
  });

  it("flags missing availability dates, empty tables and missing candles", () => {
    const gaps = detectPipelineGaps({
      priceDaily: null,
      dailyCandles: { hasRows: false, latestDate: null },
      fundamentals: { financialRows: 8, missingFilingDate: 8, missingAvailableFrom: 6 },
      corporateActionsHasRows: false,
      universeMembershipHasRows: false,
      quoteSnapshotsHasRows: false,
    });
    expect(gaps.map((gap) => gap.id)).toEqual([
      "no_daily_candles",
      "fundamentals_missing_availability",
      "corporate_actions_empty",
      "universe_membership_empty",
      "quote_snapshots_empty",
    ]);
    expect(gaps[1]!.detail).toContain("8 of 8");
  });
});
