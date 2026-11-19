/**
 * Bounded read queries behind the data-quality and reliability reports. Every
 * query is either scoped to an explicit symbol list (≤ UNIVERSE_CAP) and
 * aggregated in SQL, or a constant-size EXISTS/MAX/GROUP BY probe: no query
 * returns raw bar rows.
 *
 * Drizzle replaces the shared postgres client's timestamp parsers, so
 * timestamps cross this boundary as ISO strings: parameters are sent as
 * strings and results are formatted with to_char(... AT TIME ZONE 'UTC', ISO).
 */
import type { Sql } from "postgres";
import { getSqlClient } from "../../data/drizzle/client";
import type { BarValues, StructuralProbe } from "./evaluator";

/** Daily bars as consumers read them: the candles table, timeframe "1d". */
const DAILY_TIMEFRAME = "1d";
/** Invalid-bar examples returned per symbol. */
export const INVALID_SAMPLES_PER_SYMBOL = 3;
/** Most symbols the "active" universe reads. */
export const ACTIVE_UNIVERSE_CAP = 200;

export interface CandleAggregate {
  symbol: string;
  firstDate: string | null;
  latestDate: string | null;
  latestSource: string | null;
  presentSessions: number;
  invalidBars: number;
  zeroVolumeBars: number;
  invalidSamples: Array<BarValues & { date: string }>;
}

/**
 * Per-symbol daily coverage over `windowSessions` (IST dates, oldest first).
 * The invalid predicate is the SQL twin of evaluator.barIssues minus zero volume.
 */
export async function loadCandleAggregates(
  symbols: readonly string[],
  windowSessions: readonly string[],
  sql: Sql = getSqlClient(),
): Promise<CandleAggregate[]> {
  if (symbols.length === 0) return [];
  const windowStart = new Date(`${windowSessions[0] ?? "9999-12-31"}T00:00:00.000+05:30`).toISOString();
  const rows = await sql<Array<{
    symbol: string;
    first_date: string | null;
    latest_date: string | null;
    latest_source: string | null;
    present_sessions: number;
    invalid_bars: number;
    zero_volume_bars: number;
    invalid_samples: Array<BarValues & { date: string }> | null;
  }>>`
    WITH universe AS (
      SELECT unnest(${symbols as string[]}::text[]) AS symbol
    ),
    window_bars AS (
      SELECT c.symbol,
             (c.ts AT TIME ZONE 'Asia/Kolkata')::date AS d,
             c.open, c.high, c.low, c.close, c.volume,
             (
               c.open IS NULL OR c.high IS NULL OR c.low IS NULL OR c.close IS NULL
               OR LEAST(c.open, c.high, c.low, c.close) <= 0
               OR c.high < c.low
               OR c.open > c.high OR c.open < c.low
               OR c.close > c.high OR c.close < c.low
               OR c.volume IS NULL OR c.volume < 0
             ) AS invalid
      FROM candles c
      WHERE c.timeframe = ${DAILY_TIMEFRAME}
        AND c.symbol = ANY(${symbols as string[]}::text[])
        AND c.ts >= ${windowStart}::timestamptz
    ),
    agg AS (
      SELECT symbol,
             -- date[] parameters have no serializer under Drizzle's type overrides; text[] does.
             count(DISTINCT d) FILTER (WHERE d = ANY(${windowSessions as string[]}::text[]::date[]))::int AS present_sessions,
             count(*) FILTER (WHERE invalid)::int AS invalid_bars,
             count(*) FILTER (WHERE volume = 0)::int AS zero_volume_bars,
             (array_agg(
                jsonb_build_object(
                  'date', to_char(d, 'YYYY-MM-DD'),
                  'open', open::float8, 'high', high::float8, 'low', low::float8, 'close', close::float8,
                  'volume', volume::float8
                ) ORDER BY d DESC
              ) FILTER (WHERE invalid))[1:${INVALID_SAMPLES_PER_SYMBOL}] AS invalid_samples
      FROM window_bars
      GROUP BY symbol
    )
    SELECT u.symbol,
           to_char(first_bar.ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS first_date,
           to_char(last_bar.ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS latest_date,
           last_bar.source AS latest_source,
           coalesce(agg.present_sessions, 0) AS present_sessions,
           coalesce(agg.invalid_bars, 0) AS invalid_bars,
           coalesce(agg.zero_volume_bars, 0) AS zero_volume_bars,
           to_jsonb(agg.invalid_samples) AS invalid_samples
    FROM universe u
    LEFT JOIN agg ON agg.symbol = u.symbol
    LEFT JOIN LATERAL (
      SELECT ts FROM candles
      WHERE symbol = u.symbol AND timeframe = ${DAILY_TIMEFRAME}
      ORDER BY ts ASC LIMIT 1
    ) first_bar ON true
    LEFT JOIN LATERAL (
      SELECT ts, source FROM candles
      WHERE symbol = u.symbol AND timeframe = ${DAILY_TIMEFRAME}
      ORDER BY ts DESC LIMIT 1
    ) last_bar ON true
  `;
  return rows.map((row) => ({
    symbol: row.symbol,
    firstDate: row.first_date,
    latestDate: row.latest_date,
    latestSource: row.latest_source,
    presentSessions: Number(row.present_sessions),
    invalidBars: Number(row.invalid_bars),
    zeroVolumeBars: Number(row.zero_volume_bars),
    invalidSamples: row.invalid_samples ?? [],
  }));
}

export interface QuoteAggregate {
  symbol: string;
  name: string | null;
  /** ISO-8601 UTC. */
  lastQuoteAt: string | null;
  quoteSource: string | null;
}

/** Company name and newest stored quote snapshot per symbol. */
export async function loadQuoteAggregates(symbols: readonly string[], sql: Sql = getSqlClient()): Promise<QuoteAggregate[]> {
  if (symbols.length === 0) return [];
  const rows = await sql<Array<{ symbol: string; name: string | null; as_of: string | null; source: string | null }>>`
    SELECT u.symbol, co.name,
           to_char(q.as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of,
           q.source
    FROM unnest(${symbols as string[]}::text[]) AS u(symbol)
    LEFT JOIN companies co ON co.symbol = u.symbol
    LEFT JOIN LATERAL (
      SELECT as_of, source FROM quote_snapshots
      WHERE company_id = co.id
      ORDER BY as_of DESC LIMIT 1
    ) q ON true
  `;
  return rows.map((row) => ({ symbol: row.symbol, name: row.name, lastQuoteAt: row.as_of, quoteSource: row.source }));
}

export interface FundamentalsAggregate {
  symbol: string;
  financialRows: number;
  missingFilingDate: number;
  missingAvailableFrom: number;
  rowsMissingAvailability: number;
  latestPeriod: string | null;
  latestPeriodType: string | null;
}

/** Reported-period fundamentals (daily "market" snapshots excluded) per symbol. */
export async function loadFundamentalsAggregates(
  symbols: readonly string[],
  sql: Sql = getSqlClient(),
): Promise<FundamentalsAggregate[]> {
  if (symbols.length === 0) return [];
  const rows = await sql<Array<{
    symbol: string;
    financial_rows: number;
    missing_filing_date: number;
    missing_available_from: number;
    missing_availability: number;
    latest_period: string | null;
    latest_period_type: string | null;
  }>>`
    SELECT co.symbol,
           count(*)::int AS financial_rows,
           count(*) FILTER (WHERE f.filing_date IS NULL)::int AS missing_filing_date,
           count(*) FILTER (WHERE f.available_from IS NULL)::int AS missing_available_from,
           count(*) FILTER (WHERE f.filing_date IS NULL OR f.available_from IS NULL)::int AS missing_availability,
           to_char(max(f.period_date) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS latest_period,
           (array_agg(f.period_type ORDER BY f.period_date DESC))[1] AS latest_period_type
    FROM companies co
    JOIN fundamentals f ON f.company_id = co.id
    WHERE co.symbol = ANY(${symbols as string[]}::text[])
      AND f.period_type <> 'market'
    GROUP BY co.symbol
  `;
  return rows.map((row) => ({
    symbol: row.symbol,
    financialRows: Number(row.financial_rows),
    missingFilingDate: Number(row.missing_filing_date),
    missingAvailableFrom: Number(row.missing_available_from),
    rowsMissingAvailability: Number(row.missing_availability),
    latestPeriod: row.latest_period,
    latestPeriodType: row.latest_period_type,
  }));
}

export interface CorporateActionAggregate {
  symbol: string;
  count: number;
  latestExDate: string | null;
}

export async function loadCorporateActionAggregates(
  symbols: readonly string[],
  sql: Sql = getSqlClient(),
): Promise<CorporateActionAggregate[]> {
  if (symbols.length === 0) return [];
  const rows = await sql<Array<{ symbol: string; count: number; latest_ex_date: string | null }>>`
    SELECT symbol,
           count(*)::int AS count,
           to_char(max(ex_date) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS latest_ex_date
    FROM corporate_actions
    WHERE symbol = ANY(${symbols as string[]}::text[])
    GROUP BY symbol
  `;
  return rows.map((row) => ({ symbol: row.symbol, count: Number(row.count), latestExDate: row.latest_ex_date }));
}

/** The EXISTS/MAX half of StructuralProbe; candle and fundamentals figures come from the universe aggregates. */
export type TableProbe = Pick<StructuralProbe, "priceDaily" | "corporateActionsHasRows" | "universeMembershipHasRows" | "quoteSnapshotsHasRows">;

export async function loadTableProbe(sql: Sql = getSqlClient()): Promise<TableProbe> {
  const [probe] = await sql<Array<{
    price_daily_exists: boolean;
    corporate_actions: boolean;
    universe_membership: boolean;
    quote_snapshots: boolean;
  }>>`
    SELECT to_regclass('public.price_daily') IS NOT NULL AS price_daily_exists,
           EXISTS (SELECT 1 FROM corporate_actions) AS corporate_actions,
           EXISTS (SELECT 1 FROM universe_membership) AS universe_membership,
           EXISTS (SELECT 1 FROM quote_snapshots) AS quote_snapshots
  `;
  let priceDaily: TableProbe["priceDaily"] = null;
  if (probe?.price_daily_exists) {
    // max(date) walks price_daily_date_idx.
    const [latest] = await sql<Array<{ latest: string | null }>>`
      SELECT to_char(max(date), 'YYYY-MM-DD') AS latest FROM public.price_daily
    `;
    priceDaily = { hasRows: latest?.latest != null, latestDate: latest?.latest ?? null };
  }
  return {
    priceDaily,
    corporateActionsHasRows: Boolean(probe?.corporate_actions),
    universeMembershipHasRows: Boolean(probe?.universe_membership),
    quoteSnapshotsHasRows: Boolean(probe?.quote_snapshots),
  };
}

/** Largest active NSE companies by stored market cap. */
export async function loadActiveUniverse(
  cap: number = ACTIVE_UNIVERSE_CAP,
  sql: Sql = getSqlClient(),
): Promise<Array<{ symbol: string; name: string }>> {
  return await sql<Array<{ symbol: string; name: string }>>`
    SELECT symbol, name FROM companies
    WHERE exchange = 'NSE' AND is_active IS NOT FALSE
    ORDER BY market_cap DESC NULLS LAST, symbol
    LIMIT ${cap}
  `;
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

export interface StrategyQueueRow {
  kind: "backtest" | "sweep" | "walk-forward";
  status: string;
  count: number;
  /** ISO-8601 UTC. */
  oldestQueuedAt: string | null;
  lastCompletedAt: string | null;
  abandoned: number | null;
}

/** Job counts per status for the three strategy job queues. */
export async function loadStrategyQueueRows(sql: Sql = getSqlClient()): Promise<StrategyQueueRow[]> {
  const rows = await sql<Array<{
    kind: StrategyQueueRow["kind"];
    status: string;
    count: number;
    oldest_queued_at: string | null;
    last_completed_at: string | null;
    abandoned: number | null;
  }>>`
    SELECT 'backtest' AS kind, status, count(*)::int AS count,
           to_char(min(requested_at) FILTER (WHERE status = 'QUEUED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest_queued_at,
           to_char(max(completed_at) FILTER (WHERE status = 'COMPLETED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_completed_at,
           count(*) FILTER (WHERE error_code = 'ABANDONED')::int AS abandoned
    FROM strategy_backtest_jobs GROUP BY status
    UNION ALL
    SELECT 'sweep', status, count(*)::int,
           to_char(min(created_at) FILTER (WHERE status = 'QUEUED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           to_char(max(updated_at) FILTER (WHERE status = 'COMPLETED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           NULL::int
    FROM strategy_parameter_sweeps GROUP BY status
    UNION ALL
    SELECT 'walk-forward', status, count(*)::int,
           to_char(min(created_at) FILTER (WHERE status = 'QUEUED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           to_char(max(updated_at) FILTER (WHERE status = 'COMPLETED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           NULL::int
    FROM strategy_walk_forward_runs GROUP BY status
  `;
  return rows.map((row) => ({
    kind: row.kind,
    status: row.status,
    count: Number(row.count),
    oldestQueuedAt: row.oldest_queued_at,
    lastCompletedAt: row.last_completed_at,
    abandoned: row.abandoned === null ? null : Number(row.abandoned),
  }));
}

export interface IngestionWorkerRow {
  source: string;
  dataType: string;
  runs: number;
  failedRuns: number;
  retries: number;
  lastStatus: string;
  /** ISO-8601 UTC. */
  lastStartedAt: string;
  lastSucceededAt: string | null;
}

/** Per (source, data type) ingestion history from ingestion_runs, newest first. */
export async function loadIngestionWorkerRows(limit = 20, sql: Sql = getSqlClient()): Promise<IngestionWorkerRow[]> {
  const rows = await sql<Array<{
    source: string;
    data_type: string;
    runs: number;
    failed_runs: number;
    retries: number;
    last_status: string;
    last_started_at: string;
    last_succeeded_at: string | null;
  }>>`
    SELECT source, data_type,
           count(*)::int AS runs,
           count(*) FILTER (WHERE status = 'failed')::int AS failed_runs,
           coalesce(sum(retry_count), 0)::int AS retries,
           (array_agg(status ORDER BY started_at DESC))[1] AS last_status,
           to_char(max(started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_started_at,
           to_char(max(coalesce(completed_at, started_at)) FILTER (WHERE status IN ('succeeded', 'success')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_succeeded_at
    FROM ingestion_runs
    GROUP BY source, data_type
    ORDER BY max(started_at) DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    source: row.source,
    dataType: row.data_type,
    runs: Number(row.runs),
    failedRuns: Number(row.failed_runs),
    retries: Number(row.retries),
    lastStatus: row.last_status,
    lastStartedAt: row.last_started_at,
    lastSucceededAt: row.last_succeeded_at,
  }));
}

/** Retry totals and age of the unresolved dead-letter backlog (counts come from getDLQStats). */
export async function loadDeadLetterBacklog(sql: Sql = getSqlClient()): Promise<{ pendingRetries: number; oldestPendingAt: string | null }> {
  const [row] = await sql<Array<{ pending_retries: number; oldest_pending_at: string | null }>>`
    SELECT coalesce(sum(retry_count), 0)::int AS pending_retries,
           to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest_pending_at
    FROM dead_letter_queue WHERE resolved_at IS NULL
  `;
  return { pendingRetries: Number(row?.pending_retries ?? 0), oldestPendingAt: row?.oldest_pending_at ?? null };
}
