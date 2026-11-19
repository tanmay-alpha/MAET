/**
 * Pure market-data quality rules: NSE session calendar, per-bar checks,
 * per-symbol freshness and the structural pipeline-gap rules. No I/O; the
 * repository supplies SQL aggregates and the service assembles the report.
 */
import { computePhase, istClock, istDateKey } from "../../domain/market/clock";
import type {
  BarIssue,
  DataQualitySummary,
  Freshness,
  PipelineGap,
  SymbolQualityRow,
} from "./contracts";

const DAY_MS = 86_400_000;
/** NSE cash session close, 15:30 IST: a session's daily bar is final from then on. */
export const SESSION_CLOSE_IST_MINUTES = 15 * 60 + 30;
/** Sessions a daily series may trail the latest completed session and still count as fresh. */
export const FRESH_MAX_SESSIONS_BEHIND = 1;
/** Sessions checked for gaps and invalid bars. */
export const DEFAULT_WINDOW_SESSIONS = 60;
/** Quote sources that stream exchange ticks in real time; every other source is delayed. */
const REALTIME_QUOTE_SOURCES: Record<string, true> = { angelone: true };

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** True when `date` (IST, YYYY-MM-DD) is an NSE trading day: a weekday that is not a listed holiday. */
export function isNseTradingDate(date: string, holidays: Date[]): boolean {
  // Noon IST is OPEN on a trading day, CLOSED on a weekend and HOLIDAY on a holiday.
  return computePhase(new Date(`${date}T06:30:00.000Z`), holidays) === "OPEN";
}

/**
 * The newest NSE session that has closed at `now`: today from 15:30 IST on a
 * trading day, otherwise the previous trading day.
 */
export function latestCompletedSession(now: Date, holidays: Date[]): string {
  const today = istDateKey(now);
  if (isNseTradingDate(today, holidays) && istClock(now).minutes >= SESSION_CLOSE_IST_MINUTES) return today;
  let date = shiftDate(today, -1);
  // Longest NSE closure is a long weekend plus holidays; 31 days bounds a broken calendar.
  for (let i = 0; i < 31 && !isNseTradingDate(date, holidays); i++) date = shiftDate(date, -1);
  return date;
}

/** The `count` trading sessions ending at `lastSession` (inclusive when it is a session), oldest first. */
export function recentSessions(lastSession: string, count: number, holidays: Date[]): string[] {
  const sessions: string[] = [];
  let date = lastSession;
  // Weekends and holidays add < 50% calendar days; the cap only stops a broken calendar.
  for (let i = 0; sessions.length < count && i < count * 3 + 31; i++) {
    if (isNseTradingDate(date, holidays)) sessions.push(date);
    date = shiftDate(date, -1);
  }
  return sessions.reverse();
}

/** Trading sessions in (fromExclusive, toInclusive]; 0 when `fromExclusive` is not before `toInclusive`. */
export function sessionsBetween(fromExclusive: string, toInclusive: string, holidays: Date[]): number {
  let count = 0;
  for (let date = shiftDate(fromExclusive, 1); date <= toInclusive; date = shiftDate(date, 1)) {
    if (isNseTradingDate(date, holidays)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export interface BarValues {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** Every check a daily bar fails. The SQL aggregate in repository.ts applies the same rules. */
export function barIssues(bar: BarValues): BarIssue[] {
  const issues: BarIssue[] = [];
  const { open, high, low, close, volume } = bar;
  const prices = [open, high, low, close];
  if (prices.some((price) => price === null || !Number.isFinite(price) || price <= 0)) {
    issues.push("non_positive_price");
  }
  if (high !== null && low !== null && high < low) issues.push("high_below_low");
  if (open !== null && high !== null && low !== null && (open > high || open < low)) issues.push("open_outside_range");
  if (close !== null && high !== null && low !== null && (close > high || close < low)) issues.push("close_outside_range");
  if (volume === null || !Number.isFinite(volume)) issues.push("missing_volume");
  else if (volume < 0) issues.push("negative_volume");
  else if (volume === 0) issues.push("zero_volume");
  return issues;
}

/** True when a bar fails a hard check; a zero-volume session alone is only a warning. */
export function isInvalidBar(issues: readonly BarIssue[]): boolean {
  return issues.some((issue) => issue !== "zero_volume");
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

export interface CandleCoverage {
  /** IST date of the oldest stored daily bar, any age. */
  firstDate: string | null;
  /** IST date of the newest stored daily bar. */
  latestDate: string | null;
  /** Distinct window sessions with a stored bar. */
  presentSessions: number;
}

export interface CalendarContext {
  latestCompletedSession: string;
  /** Window sessions, oldest first. */
  windowSessions: readonly string[];
  holidays: Date[];
}

export interface FreshnessResult {
  freshness: Freshness;
  sessionsBehind: number | null;
  expectedSessions: number;
  missingSessions: number;
}

export function classifyFreshness(sessionsBehind: number | null): Freshness {
  if (sessionsBehind === null) return "missing";
  return sessionsBehind > FRESH_MAX_SESSIONS_BEHIND ? "stale" : "fresh";
}

/**
 * Freshness and window gaps for one symbol. Window sessions before its first
 * stored bar are not expected (recent listing or shorter backfill); every
 * other window session without a bar is missing, including trailing ones.
 */
export function evaluateCoverage(coverage: CandleCoverage, calendar: CalendarContext): FreshnessResult {
  const { firstDate, latestDate } = coverage;
  if (latestDate === null || firstDate === null) {
    return { freshness: "missing", sessionsBehind: null, expectedSessions: calendar.windowSessions.length, missingSessions: calendar.windowSessions.length };
  }
  const sessionsBehind = sessionsBetween(latestDate, calendar.latestCompletedSession, calendar.holidays);
  const expectedSessions = calendar.windowSessions.filter((session) => session >= firstDate).length;
  return {
    freshness: classifyFreshness(sessionsBehind),
    sessionsBehind,
    expectedSessions,
    missingSessions: Math.max(expectedSessions - coverage.presentSessions, 0),
  };
}

export function isDelayedQuoteSource(source: string): boolean {
  return REALTIME_QUOTE_SOURCES[source] !== true;
}

export function summarize(rows: readonly SymbolQualityRow[]): DataQualitySummary {
  const summary: DataQualitySummary = {
    symbols: rows.length,
    withDailyCandles: 0,
    coveragePct: 0,
    fresh: 0,
    stale: 0,
    missing: 0,
    invalidBars: 0,
    symbolsWithInvalidBars: 0,
    zeroVolumeBars: 0,
    missingSessions: 0,
    expectedSessions: 0,
    quotesCovered: 0,
    lastQuote: null,
    fundamentalsCovered: 0,
    fundamentalsMissingAvailability: 0,
    corporateActionsCovered: 0,
  };
  for (const row of rows) {
    summary[row.freshness]++;
    if (row.latestCandleDate !== null) summary.withDailyCandles++;
    summary.invalidBars += row.invalidBars;
    if (row.invalidBars > 0) summary.symbolsWithInvalidBars++;
    summary.zeroVolumeBars += row.zeroVolumeBars;
    summary.missingSessions += row.missingSessions;
    summary.expectedSessions += row.expectedSessions;
    if (row.lastQuoteAt !== null && row.quoteSource !== null) {
      summary.quotesCovered++;
      if (summary.lastQuote === null || row.lastQuoteAt > summary.lastQuote.at) {
        summary.lastQuote = { at: row.lastQuoteAt, source: row.quoteSource, delayed: row.quoteDelayed ?? true };
      }
    }
    if (row.fundamentals.financialRows > 0) summary.fundamentalsCovered++;
    summary.fundamentalsMissingAvailability += row.fundamentals.rowsMissingAvailability;
    if (row.corporateActions.count > 0) summary.corporateActionsCovered++;
  }
  summary.coveragePct = rows.length === 0 ? 0 : Math.round((summary.withDailyCandles / rows.length) * 1000) / 10;
  return summary;
}

// ---------------------------------------------------------------------------
// Pipeline gaps
// ---------------------------------------------------------------------------

/** Cheap EXISTS/MAX/COUNT probes over the tables behind the read paths. */
export interface StructuralProbe {
  /** null when the price_daily table does not exist. */
  priceDaily: { hasRows: boolean; latestDate: string | null } | null;
  dailyCandles: { hasRows: boolean; latestDate: string | null };
  fundamentals: { financialRows: number; missingFilingDate: number; missingAvailableFrom: number };
  corporateActionsHasRows: boolean;
  universeMembershipHasRows: boolean;
  quoteSnapshotsHasRows: boolean;
}

export function detectPipelineGaps(probe: StructuralProbe): PipelineGap[] {
  const gaps: PipelineGap[] = [];
  const { priceDaily, dailyCandles, fundamentals } = probe;

  if (!dailyCandles.hasRows) {
    gaps.push({
      id: "no_daily_candles",
      severity: "critical",
      title: "No daily candles stored",
      detail: "The candles table has no 1d rows. Charts fall back to Yahoo Finance, and the screener and backtests have no stored history.",
    });
  }
  if (priceDaily?.hasRows) {
    const behind = dailyCandles.latestDate === null || (priceDaily.latestDate !== null && priceDaily.latestDate > dailyCandles.latestDate);
    gaps.push({
      id: "price_daily_not_consumed",
      severity: behind ? "critical" : "warning",
      title: "Legacy price_daily rows are not read by the app",
      detail: `price_daily holds daily bars up to ${priceDaily.latestDate ?? "an unknown date"}. The ingestion pipeline now writes candles, and charts, the screener and backtests read only candles (latest 1d bar ${dailyCandles.latestDate ?? "none"}). These rows are left over from the earlier pipeline${behind ? ", and bars newer than the latest candle are invisible to users until candles are backfilled" : ""}.`,
    });
  }
  if (fundamentals.financialRows > 0 && (fundamentals.missingFilingDate > 0 || fundamentals.missingAvailableFrom > 0)) {
    const missing = Math.max(fundamentals.missingFilingDate, fundamentals.missingAvailableFrom);
    gaps.push({
      id: "fundamentals_missing_availability",
      severity: "warning",
      title: "Fundamentals lack filing and availability dates",
      detail: `${missing} of ${fundamentals.financialRows} quarterly/annual fundamentals rows have no filing_date (${fundamentals.missingFilingDate}) or available_from (${fundamentals.missingAvailableFrom}). Point-in-time research cannot tell when those figures became public, so look-ahead bias cannot be ruled out.`,
    });
  }
  if (!probe.corporateActionsHasRows) {
    gaps.push({
      id: "corporate_actions_empty",
      severity: "warning",
      title: "corporate_actions is empty",
      detail: "No splits, bonuses or dividends are stored: the corporate-action ingestion (daily processor after the close, or the admin trigger) has not completed a run. Until it does, backtests cannot warn about corporate actions inside their window. Charts read corporate actions live from Yahoo Finance.",
    });
  }
  if (!probe.universeMembershipHasRows) {
    gaps.push({
      id: "universe_membership_empty",
      severity: "warning",
      title: "universe_membership is empty",
      detail: "Historical index membership is not recorded, so universe backtests use today's constituents (survivorship bias). This report uses the bundled Nifty 50 list.",
    });
  }
  if (!probe.quoteSnapshotsHasRows) {
    gaps.push({
      id: "quote_snapshots_empty",
      severity: "info",
      title: "No stored quote snapshots",
      detail: "quote_snapshots is empty: the screener and market breadth have no persisted prices. Live quotes still come from Angel One or Yahoo Finance on request.",
    });
  }
  return gaps;
}
