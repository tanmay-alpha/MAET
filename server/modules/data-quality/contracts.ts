/**
 * Wire contracts for the market-data quality report (public) and the
 * reliability report (admin). Types only: the frontend imports them.
 */

export type Freshness = "fresh" | "stale" | "missing";

export const DATA_QUALITY_UNIVERSES = ["nifty50", "active"] as const;
export type DataQualityUniverse = (typeof DATA_QUALITY_UNIVERSES)[number];

/** Per-bar validation failures. `zero_volume` is a warning, every other issue makes a bar invalid. */
export type BarIssue =
  | "high_below_low"
  | "open_outside_range"
  | "close_outside_range"
  | "non_positive_price"
  | "negative_volume"
  | "missing_volume"
  | "zero_volume";

export interface InvalidBarSample {
  /** IST session date of the bar. */
  date: string;
  issues: BarIssue[];
}

export interface SymbolQualityRow {
  symbol: string;
  name: string | null;
  freshness: Freshness;
  /** IST date of the newest stored daily candle. */
  latestCandleDate: string | null;
  /** Trading sessions after the latest candle up to the latest completed session; null when no candles. */
  sessionsBehind: number | null;
  /** Window sessions the symbol should have a bar for (window sessions on or after its first stored bar). */
  expectedSessions: number;
  missingSessions: number;
  /** Bars inside the window failing at least one hard check. */
  invalidBars: number;
  zeroVolumeBars: number;
  invalidSamples: InvalidBarSample[];
  candleSource: string | null;
  lastQuoteAt: string | null;
  quoteSource: string | null;
  quoteDelayed: boolean | null;
  fundamentals: {
    /** Latest reported financial period (quarterly/annual rows, not market snapshots). */
    latestPeriod: string | null;
    latestPeriodType: string | null;
    financialRows: number;
    /** Financial rows without filing_date or available_from: unusable for point-in-time research. */
    rowsMissingAvailability: number;
  };
  corporateActions: {
    count: number;
    latestExDate: string | null;
  };
}

export type PipelineGapSeverity = "critical" | "warning" | "info";

export interface PipelineGap {
  id: "price_daily_not_consumed" | "no_daily_candles" | "fundamentals_missing_availability" | "corporate_actions_empty" | "universe_membership_empty" | "quote_snapshots_empty";
  severity: PipelineGapSeverity;
  title: string;
  detail: string;
}

export interface DataQualitySummary {
  symbols: number;
  withDailyCandles: number;
  /** Share of universe symbols with at least one stored daily candle, 0-100. */
  coveragePct: number;
  fresh: number;
  stale: number;
  missing: number;
  invalidBars: number;
  symbolsWithInvalidBars: number;
  zeroVolumeBars: number;
  missingSessions: number;
  expectedSessions: number;
  quotesCovered: number;
  lastQuote: { at: string; source: string; delayed: boolean } | null;
  fundamentalsCovered: number;
  fundamentalsMissingAvailability: number;
  corporateActionsCovered: number;
}

export interface DataQualityReport {
  asOf: string;
  /** Where every figure in the report was read from. */
  source: "database";
  universe: { id: DataQualityUniverse; label: string; symbolCount: number; cap: number };
  calendar: {
    timezone: "Asia/Kolkata";
    /** Latest NSE session whose 15:30 IST close has passed. */
    latestCompletedSession: string;
    windowStart: string | null;
    windowSessions: number;
    holidaysConfigured: number;
  };
  summary: DataQualitySummary;
  symbols: SymbolQualityRow[];
  pipelineGaps: PipelineGap[];
}

// ---------------------------------------------------------------------------
// Reliability (admin)
// ---------------------------------------------------------------------------

/** One ingestion_runs row as the admin page lists it. */
export interface IngestionBatchView {
  id: string;
  batchId: string;
  source: string;
  dataType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  retryCount: number;
  errorSummary: string | null;
}

export type Unavailable = { available: false; reason: string };

export interface StrategyQueueStats {
  kind: "backtest" | "sweep" | "walk-forward";
  byStatus: Record<string, number>;
  oldestQueuedAt: string | null;
  lastCompletedAt: string | null;
  /** RUNNING backtests failed by abandoned-job recovery; null where the queue does not record it. */
  abandoned: number | null;
}

export interface IngestionWorkerStats {
  source: string;
  dataType: string;
  runs: number;
  failedRuns: number;
  retries: number;
  lastStatus: string;
  lastStartedAt: string;
  lastSucceededAt: string | null;
}

export interface ReliabilityReport {
  asOf: string;
  health:
    | { available: true; status: "ok" | "degraded" | "down"; checks: Record<"database" | "redis" | "orchestrator" | "marketData", boolean>; databaseCircuit: string | null }
    | Unavailable;
  strategyJobs:
    | { available: true; queues: StrategyQueueStats[]; retryNote: string }
    | Unavailable;
  ingestion:
    | { available: true; workers: IngestionWorkerStats[] }
    | Unavailable;
  deadLetterQueue:
    | { available: true; total: number; pending: number; resolved: number; pendingRetries: number; oldestPendingAt: string | null; bySource: Record<string, number> }
    | Unavailable;
  dailyProcessor:
    | { available: true; session: string; completed: boolean }
    | Unavailable;
}
