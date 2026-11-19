/**
 * Research run report: an immutable description of one completed strategy backtest job — what ran
 * (definition and its hash, engine versions, server commit), on what data (symbols, window, candle
 * count and fingerprint), under which costs, against which benchmark, and with what results —
 * plus a SHA-256 reproducibility hash over all of it.
 *
 * Every input is written once when the job completes (job row, strategy version, performance
 * snapshot, trades, equity points, run metadata), so the report is a pure function of stored rows:
 * reading it twice gives the same document and hash. Fields the run did not record are null and
 * listed in `missingFields`; they are never filled in from the current server or current data.
 *
 * The hash excludes identifiers and wall-clock times (job id, user, timestamps of the request), so
 * re-running the same strategy version on the same data on the same server revision with the same
 * results reproduces the same hash.
 */

import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { canonicalJson, sha256Hex } from "./hashing";
import type { RunMetadata } from "./run-metadata";
import { drawdownSeries } from "./comparison";
import {
  RUN_REPORT_SCHEMA,
  type CostAssumptions,
  type CsvExport,
  type CsvKind,
  type ReproducibleRunRecord,
  type RunReport,
  type RunReportMetrics,
} from "./contracts";

/** Engine defaults for absent execution fields (runner-v3 / fee-model); pinned by a unit test. */
const ENGINE_DEFAULT_SLIPPAGE_BPS = 5;
const ENGINE_DEFAULT_FIXED_FEE_BPS = 10;
const ENGINE_DEFAULT_CAPITAL = 100_000;

export const REPRODUCIBILITY_HASH_SCOPE =
  "sha256 of the canonical JSON (keys sorted at every depth) of the `reproducible` section";

export interface StoredJob {
  id: string;
  runId: string | null;
  symbolOrUniverse: string;
  timeframe: string;
  fromDate: Date;
  toDate: Date;
  initialCapital: string | null;
  benchmarkSymbol: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  reproducibilityMetadata: RunMetadata | null;
  warnings: unknown;
}

export interface StoredVersion {
  id: string;
  strategyId: string;
  strategyName: string;
  versionNumber: number;
  definition: unknown;
  definitionHash: string;
  engineVersion: string;
  indicatorVersion: string;
  schemaVersion: number;
}

type Numeric = string | null;

export interface StoredSnapshot {
  totalReturn: Numeric;
  annualizedReturn: Numeric;
  maxDrawdown: Numeric;
  sharpe: Numeric;
  sortino: Numeric;
  calmar: Numeric;
  winRate: Numeric;
  profitFactor: Numeric;
  expectancy: Numeric;
  tradeCount: number | null;
  longTradeCount: number | null;
  shortTradeCount: number | null;
  feesPaid: Numeric;
  slippageCost: Numeric;
  netProfit: Numeric;
  exposurePercent: Numeric;
  benchmarkReturn: Numeric;
  alpha: Numeric;
  dataHash: string | null;
  engineVersion: string | null;
  feeModel: string | null;
  warnings: unknown;
}

export interface StoredTrade {
  symbol: string;
  direction: string;
  entrySignalTimestamp: Date | null;
  entryFillTimestamp: Date | null;
  entryPrice: string;
  entryQuantity: string;
  exitSignalTimestamp: Date | null;
  exitFillTimestamp: Date | null;
  exitPrice: Numeric;
  exitQuantity: Numeric;
  grossPnl: Numeric;
  fees: string;
  slippage: string;
  netPnl: Numeric;
  returnPercent: Numeric;
  holdingBars: number | null;
  mfe: Numeric;
  mae: Numeric;
  entryReason: string | null;
  exitReason: string | null;
}

export interface StoredEquityPoint {
  timestamp: Date;
  equity: string;
  benchmark: Numeric;
}

export interface StoredRun {
  job: StoredJob;
  version: StoredVersion;
  snapshot: StoredSnapshot | null;
  trades: StoredTrade[];
  equity: StoredEquityPoint[];
}

function num(value: Numeric | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The definition's execution block, or {} when it has none (the engine then uses its defaults). */
export function executionOf(definition: unknown): Partial<StrategyExecutionConfig> {
  const execution = (definition as { execution?: unknown } | null)?.execution;
  return execution && typeof execution === "object" ? (execution as Partial<StrategyExecutionConfig>) : {};
}

/** Cost and fill assumptions as the engine applies them: absent fields take the engine's defaults. */
export function effectiveCostAssumptions(execution: Partial<StrategyExecutionConfig>): CostAssumptions {
  const feeModel = execution.feeModel === "NONE" || execution.feeModel === "FIXED_BPS" ? execution.feeModel : "VOLUME_AWARE";
  return {
    fillPolicy: execution.fillPolicy === "ON_CLOSE" ? "ON_CLOSE" : "NEXT_BAR_OPEN",
    intrabarPolicy: textOrNull(execution.intrabarPolicy),
    feeModel,
    feeBps: feeModel === "FIXED_BPS" ? finiteOrNull(execution.feeBps) ?? ENGINE_DEFAULT_FIXED_FEE_BPS : null,
    exchange: feeModel === "VOLUME_AWARE" ? execution.exchange ?? "NSE" : null,
    product: feeModel === "VOLUME_AWARE" ? execution.product ?? "DELIVERY" : null,
    brokerage: feeModel === "VOLUME_AWARE" ? finiteOrNull(execution.brokerage) ?? 0 : null,
    slippageBps: finiteOrNull(execution.slippageBps) ?? ENGINE_DEFAULT_SLIPPAGE_BPS,
    spreadModel: textOrNull(execution.spreadModel),
    baseSpreadBps: finiteOrNull(execution.baseSpreadBps),
    marketImpactModel: textOrNull(execution.marketImpactModel),
    impactCoefficient: finiteOrNull(execution.impactCoefficient),
    maxImpactBps: finiteOrNull(execution.maxImpactBps),
    maxParticipationRate: finiteOrNull(execution.maxParticipationRate),
  };
}

/** Capital the run started with: the job's override, else the definition's, else the engine default. */
export function effectiveInitialCapital(job: Pick<StoredJob, "initialCapital">, definition: unknown): number {
  return num(job.initialCapital) ?? finiteOrNull(executionOf(definition).initialCapital) ?? ENGINE_DEFAULT_CAPITAL;
}

/** Benchmark the run asked for: the job's, else the definition's. */
export function requestedBenchmark(job: Pick<StoredJob, "benchmarkSymbol">, definition: unknown): string | null {
  return textOrNull(job.benchmarkSymbol) ?? textOrNull(executionOf(definition).benchmarkSymbol);
}

/** The symbols a job's symbolOrUniverse names ("A|B" lists several; the backtest worker runs the first). */
function jobSymbols(symbolOrUniverse: string): string[] {
  return symbolOrUniverse.split("|").map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

/**
 * One CSV cell. Text cells that a spreadsheet would evaluate as a formula (= + - @, tab, CR) get a
 * leading apostrophe; numeric cells are written as stored.
 */
function csvCell(value: string | number | null, kind: "text" | "number" = "number"): string {
  if (value === null) return "";
  let text = String(value);
  if (kind === "text" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

const TRADE_COLUMNS = [
  "symbol", "direction", "entry_signal_ts", "entry_fill_ts", "entry_price", "entry_quantity",
  "exit_signal_ts", "exit_fill_ts", "exit_price", "exit_quantity", "gross_pnl", "fees", "slippage",
  "net_pnl", "return_percent", "holding_bars", "mfe", "mae", "entry_reason", "exit_reason",
] as const;

/** Trades in fill order, one row per trade; no database identifiers, so equal runs give equal files. */
export function tradesCsv(trades: readonly StoredTrade[]): string {
  const ordered = [...trades].sort(
    (a, b) =>
      (a.entryFillTimestamp?.getTime() ?? 0) - (b.entryFillTimestamp?.getTime() ?? 0) ||
      (a.exitFillTimestamp?.getTime() ?? 0) - (b.exitFillTimestamp?.getTime() ?? 0),
  );
  const rows = ordered.map((t) =>
    [
      csvCell(t.symbol, "text"), csvCell(t.direction, "text"), csvCell(iso(t.entrySignalTimestamp)), csvCell(iso(t.entryFillTimestamp)),
      csvCell(t.entryPrice), csvCell(t.entryQuantity), csvCell(iso(t.exitSignalTimestamp)), csvCell(iso(t.exitFillTimestamp)),
      csvCell(t.exitPrice), csvCell(t.exitQuantity), csvCell(t.grossPnl), csvCell(t.fees), csvCell(t.slippage), csvCell(t.netPnl),
      csvCell(t.returnPercent), csvCell(t.holdingBars), csvCell(t.mfe), csvCell(t.mae),
      csvCell(t.entryReason, "text"), csvCell(t.exitReason, "text"),
    ].join(","),
  );
  return [TRADE_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Stored equity curve with the drawdown from its running peak (a fraction, ≤ 0). */
export function equityCsv(points: readonly StoredEquityPoint[]): string {
  const ordered = [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const drawdowns = drawdownSeries(ordered.map((p) => Number(p.equity)));
  const rows = ordered.map((p, i) =>
    [csvCell(p.timestamp.toISOString()), csvCell(p.equity), csvCell(p.benchmark), csvCell(Number(drawdowns[i].toFixed(8)))].join(","),
  );
  return ["timestamp,equity,benchmark,drawdown", ...rows].join("\r\n") + "\r\n";
}

export function runCsv(run: StoredRun, kind: CsvKind): CsvExport {
  const content = kind === "trades" ? tradesCsv(run.trades) : equityCsv(run.equity);
  return { filename: `maet-run-${run.job.id}-${kind}.csv`, content, sha256: sha256Hex(content) };
}

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------

function snapshotMetrics(snapshot: StoredSnapshot | null, benchmarkApplied: boolean): RunReportMetrics {
  const s = snapshot;
  return {
    totalReturn: num(s?.totalReturn),
    annualizedReturn: num(s?.annualizedReturn),
    maxDrawdown: num(s?.maxDrawdown),
    sharpe: num(s?.sharpe),
    sortino: num(s?.sortino),
    calmar: num(s?.calmar),
    winRate: num(s?.winRate),
    profitFactor: num(s?.profitFactor),
    expectancy: num(s?.expectancy),
    tradeCount: s?.tradeCount ?? null,
    longTradeCount: s?.longTradeCount ?? null,
    shortTradeCount: s?.shortTradeCount ?? null,
    feesPaid: num(s?.feesPaid),
    slippageCost: num(s?.slippageCost),
    netProfit: num(s?.netProfit),
    exposurePercent: num(s?.exposurePercent),
    // Without a benchmark series the engine stores 0 here, which would read as "matched the market".
    benchmarkReturn: benchmarkApplied ? num(s?.benchmarkReturn) : null,
    alpha: benchmarkApplied ? num(s?.alpha) : null,
  };
}

/** Dotted paths of the nulls in `record` that mean "the run did not record this". */
function missingFieldsOf(record: Omit<ReproducibleRunRecord, "missingFields">, hasSnapshot: boolean): string[] {
  const missing: string[] = [];
  const check = (path: string, value: unknown) => {
    if (value === null) missing.push(path);
  };
  check("versions.strategyEngine", record.versions.strategyEngine);
  check("versions.indicatorEngine", record.versions.indicatorEngine);
  check("versions.feeModel", record.versions.feeModel);
  check("server.gitCommitSha", record.server.gitCommitSha);
  check("data.candleCount", record.data.candleCount);
  check("data.firstCandleTs", record.data.firstCandleTs);
  check("data.lastCandleTs", record.data.lastCandleTs);
  check("data.candleSha256", record.data.candleSha256);
  check("data.engineDataHash", record.data.engineDataHash);
  if (!hasSnapshot) missing.push("metrics");
  return missing;
}

export function buildRunReport(run: StoredRun, generatedAt: Date): RunReport {
  const { job, version, snapshot } = run;
  const meta = job.reproducibilityMetadata;
  const benchmarkApplied = run.equity.some((p) => p.benchmark !== null);
  const benchmarkSymbol = requestedBenchmark(job, version.definition);
  const tradesFile = tradesCsv(run.trades);
  const equityFile = equityCsv(run.equity);

  const known: Omit<ReproducibleRunRecord, "missingFields"> = {
    strategy: { definitionHash: version.definitionHash, schemaVersion: version.schemaVersion, definition: version.definition },
    versions: {
      strategyEngine: meta?.engineVersion ?? snapshot?.engineVersion ?? null,
      strategyEnginePinned: version.engineVersion,
      indicatorEnginePinned: version.indicatorVersion,
      indicatorEngine: meta?.indicatorVersion ?? null,
      feeModel: meta?.feeModelVersion ?? snapshot?.feeModel ?? null,
    },
    server: { gitCommitSha: meta?.gitCommitSha ?? null },
    data: {
      symbols: meta?.symbols ?? jobSymbols(job.symbolOrUniverse).slice(0, 1),
      timeframe: job.timeframe,
      window: { from: job.fromDate.toISOString(), to: job.toDate.toISOString() },
      candleCount: meta?.candleCount ?? null,
      firstCandleTs: meta?.firstCandleTs ?? null,
      lastCandleTs: meta?.lastCandleTs ?? null,
      candleSha256: meta?.candleFingerprint.value ?? null,
      candleFingerprintCanonicalForm: meta?.candleFingerprint.canonicalForm ?? null,
      engineDataHash: snapshot?.dataHash ?? null,
    },
    execution: { ...effectiveCostAssumptions(executionOf(version.definition)), initialCapital: effectiveInitialCapital(job, version.definition) },
    benchmark: { symbol: benchmarkSymbol, applied: benchmarkApplied },
    metrics: snapshotMetrics(snapshot, benchmarkApplied),
    results: {
      tradeCount: run.trades.length,
      equityPointCount: run.equity.length,
      tradesCsvSha256: sha256Hex(tradesFile),
      equityCsvSha256: sha256Hex(equityFile),
    },
  };
  const reproducible: ReproducibleRunRecord = { ...known, missingFields: missingFieldsOf(known, snapshot !== null) };

  const warnings: string[] = [];
  if (!meta) {
    warnings.push(
      "This run finished before runs recorded their server commit, indicator engine and candle fingerprint; those fields are not recorded (null) and are listed in missingFields.",
    );
  }
  if (meta && snapshot?.dataHash && !meta.candleFingerprint.value.startsWith(snapshot.dataHash)) {
    warnings.push("The recorded candle fingerprint does not match the engine's data hash for this run.");
  }
  if (benchmarkSymbol && !benchmarkApplied) {
    warnings.push(`Benchmark ${benchmarkSymbol} was requested but no benchmark series was applied, so benchmark return and alpha are not reported.`);
  }
  if (jobSymbols(job.symbolOrUniverse).length > 1) {
    warnings.push(`The job named several symbols (${job.symbolOrUniverse}); the backtest ran on ${reproducible.data.symbols.join(", ")} only.`);
  }
  for (const w of [snapshot?.warnings, job.warnings]) {
    if (Array.isArray(w)) for (const item of w) if (typeof item === "string" && !warnings.includes(item)) warnings.push(item);
  }

  return {
    schema: RUN_REPORT_SCHEMA,
    generatedAt: generatedAt.toISOString(),
    identity: {
      jobId: job.id,
      runId: job.runId,
      strategyId: version.strategyId,
      strategyName: version.strategyName,
      strategyVersionId: version.id,
      versionNumber: version.versionNumber,
      requestedAt: job.requestedAt.toISOString(),
      completedAt: iso(job.completedAt),
    },
    reproducible,
    reproducibilityHash: { algorithm: "sha256", scope: REPRODUCIBILITY_HASH_SCOPE, value: sha256Hex(canonicalJson(reproducible)) },
    warnings,
  };
}
