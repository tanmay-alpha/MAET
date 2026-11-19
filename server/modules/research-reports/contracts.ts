/**
 * Research run reports and run comparisons: the JSON the researchReports procedures return.
 * Timestamps are ISO-8601 strings; fractions are plain numbers (0.12 = 12%).
 */

export const RUN_REPORT_SCHEMA = "maet.research-run-report/v1";

/** Execution assumptions that change costs and fills, with the engine's defaults filled in. */
export interface CostAssumptions {
  fillPolicy: "NEXT_BAR_OPEN" | "ON_CLOSE";
  intrabarPolicy: string | null;
  feeModel: "NONE" | "FIXED_BPS" | "VOLUME_AWARE";
  /** FIXED_BPS only: bps of notional per leg. */
  feeBps: number | null;
  /** VOLUME_AWARE only: statutory schedule and brokerage (INR per leg). */
  exchange: string | null;
  product: string | null;
  brokerage: number | null;
  slippageBps: number;
  /** Declared in the definition; null where it is not. */
  spreadModel: string | null;
  baseSpreadBps: number | null;
  marketImpactModel: string | null;
  impactCoefficient: number | null;
  maxImpactBps: number | null;
  maxParticipationRate: number | null;
}

export interface RunReportMetrics {
  totalReturn: number | null;
  annualizedReturn: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  winRate: number | null;
  profitFactor: number | null;
  /** Average net P&L per trade, INR. */
  expectancy: number | null;
  tradeCount: number | null;
  longTradeCount: number | null;
  shortTradeCount: number | null;
  feesPaid: number | null;
  slippageCost: number | null;
  netProfit: number | null;
  exposurePercent: number | null;
  /** Null when no benchmark series was applied to the run. */
  benchmarkReturn: number | null;
  alpha: number | null;
}

/** Everything the reproducibility hash covers: no identifiers, user or wall-clock times. */
export interface ReproducibleRunRecord {
  strategy: {
    definitionHash: string;
    schemaVersion: number;
    definition: unknown;
  };
  versions: {
    /** Engine that ran the job (recorded with its results). */
    strategyEngine: string | null;
    /** Engine and indicator versions the strategy version was saved against. */
    strategyEnginePinned: string;
    indicatorEnginePinned: string;
    /** Indicator engine that ran the job; null when not recorded. */
    indicatorEngine: string | null;
    feeModel: string | null;
  };
  /** Commit of the server that ran the job; null when not recorded, "unknown" when it did not know. */
  server: { gitCommitSha: string | null };
  data: {
    symbols: string[];
    timeframe: string;
    window: { from: string; to: string };
    candleCount: number | null;
    firstCandleTs: string | null;
    lastCandleTs: string | null;
    /** Full SHA-256 of the candles used; null when not recorded. */
    candleSha256: string | null;
    candleFingerprintCanonicalForm: string | null;
    /** The engine's 16-hex data hash stored with the results (prefix of candleSha256). */
    engineDataHash: string | null;
  };
  execution: CostAssumptions & { initialCapital: number };
  benchmark: {
    symbol: string | null;
    /** Whether a benchmark series was actually applied to the run's equity curve. */
    applied: boolean;
  };
  metrics: RunReportMetrics;
  results: {
    tradeCount: number;
    equityPointCount: number;
    tradesCsvSha256: string;
    equityCsvSha256: string;
  };
  /** Dotted paths of fields this run did not record (shown as null). */
  missingFields: string[];
}

export interface RunReport {
  schema: typeof RUN_REPORT_SCHEMA;
  generatedAt: string;
  identity: {
    jobId: string;
    runId: string | null;
    strategyId: string;
    strategyName: string;
    strategyVersionId: string;
    versionNumber: number;
    requestedAt: string;
    completedAt: string | null;
  };
  reproducible: ReproducibleRunRecord;
  reproducibilityHash: {
    algorithm: "sha256";
    scope: string;
    value: string;
  };
  warnings: string[];
}

export interface CompletedRunSummary {
  jobId: string;
  strategyId: string;
  strategyName: string;
  versionNumber: number;
  symbolOrUniverse: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  completedAt: string | null;
  totalReturn: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  tradeCount: number | null;
}

export type CsvKind = "trades" | "equity";

export interface CsvExport {
  filename: string;
  content: string;
  sha256: string;
}

// ------------------------------------------------------------
// Comparison
// ------------------------------------------------------------

export interface ComparisonSeriesPoint {
  date: string;
  /** Equity rebased so the first common date is 100. */
  equity: number;
  /** Drawdown from the running peak within the common window, ≤ 0 (−0.1 = −10%). */
  drawdown: number;
}

export interface ComparedRun {
  jobId: string;
  label: string;
  symbolOrUniverse: string;
  timeframe: string;
  ownWindow: { from: string | null; to: string | null; dates: number };
  /** Dates this run has that the others lack, left out of the comparison. */
  excludedDates: number;
  series: ComparisonSeriesPoint[];
  metrics: {
    totalReturn: number | null;
    cagr: number | null;
    maxDrawdown: number | null;
    sharpe: number | null;
    /** Traded notional (both legs) over average equity in the window, as a multiple. */
    turnover: number | null;
    /** Fees + slippage of trades entered in the window, as a fraction of equity at the window start. */
    costDrag: number | null;
    /** Trades entered in the window. */
    tradeCount: number | null;
  };
  costAssumptions: CostAssumptions;
  benchmarkSymbol: string | null;
  engineVersion: string | null;
}

export type ComparisonFlagCode =
  | "COST_ASSUMPTIONS_DIFFER"
  | "BENCHMARK_DIFFERS"
  | "TIMEFRAME_DIFFERS"
  | "ENGINE_VERSION_DIFFERS";

export interface ComparisonFlag {
  code: ComparisonFlagCode;
  message: string;
}

export interface RunComparison {
  intersection: {
    status: "OK" | "SINGLE_DAY" | "NO_OVERLAP";
    from: string | null;
    to: string | null;
    commonDates: number;
    /** One sentence stating the window every number below is computed over. */
    statement: string;
  };
  runs: ComparedRun[];
  likeForLike: boolean;
  flags: ComparisonFlag[];
}
