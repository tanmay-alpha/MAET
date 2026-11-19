/**
 * Corporate-action ingestion: Yahoo dividends and splits for the tracked
 * universe, upserted into corporate_actions on (symbol, action_type, ex_date)
 * and recorded as one ingestion_runs row per run. The daily processor runs it
 * after the close; admins can trigger it (ingestion.triggerCorporateActions).
 *
 * Retries and backoff are the Yahoo client's own (getCorporateActions retries
 * throttling and 5xx with exponential backoff); a symbol that still fails is
 * pushed to the dead-letter queue and the run is marked partial.
 */

import { randomUUID } from "node:crypto";
import type { CorporateActionEvent } from "@shared/types";
import { getCorporateActions } from "../../data/sources/yahoo";
import { resolveMarketSymbol, SYMBOLS } from "../../domain/market/symbol";
import { getLogger } from "../../infra/logger";
import { pushToDLQ, type DLQEntry } from "../../workers/ingestion-engine/queue/dead-letter-queue";
import { completeIngestionRun, startIngestionRun } from "../../workers/ingestion-engine/writers/supabase-writer";
import { mapCorporateActions } from "./mapping";
import { loadCompanyIds, upsertCorporateActions } from "./repository";

/** ingestion_runs.source and dead_letter_queue.source of this pipeline. */
export const CORPORATE_ACTION_RUN_SOURCE = "yahoo-corporate-actions";
/** ingestion_runs.data_type of this pipeline. */
export const CORPORATE_ACTION_PIPELINE = "corporate-actions";
/** The tracked universe: the bundled Nifty 50 list, as the data-quality report's default universe. */
export const TRACKED_CORPORATE_ACTION_SYMBOLS: readonly string[] = SYMBOLS.map((quote) => quote.symbol);

const MAX_CONCURRENT = 4;

export type CorporateActionIngestionOptions = {
  /** NSE symbols. Default: TRACKED_CORPORATE_ACTION_SYMBOLS. */
  symbols?: readonly string[];
  trigger: "daily-processor" | "admin";
  /** Fetch and map only: no ingestion_runs, corporate_actions or dead-letter writes. */
  dryRun?: boolean;
};

export type CorporateActionIngestionResult = {
  runId: string;
  status: "success" | "partial" | "failed";
  symbolsAttempted: number;
  symbolsSucceeded: number;
  symbolsFailed: number;
  failures: Array<{ symbol: string; error: string }>;
  eventsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  /** Events the table cannot hold (see mapCorporateActions). */
  recordsRejected: number;
  durationMs: number;
};

export type CorporateActionIngestionDeps = {
  fetchEvents: (ticker: string) => Promise<CorporateActionEvent[]>;
  loadCompanyIds: typeof loadCompanyIds;
  upsertRows: typeof upsertCorporateActions;
  startRun: typeof startIngestionRun;
  completeRun: typeof completeIngestionRun;
  pushToDLQ: (entry: DLQEntry) => Promise<void>;
  now: () => Date;
};

export const corporateActionIngestionDeps: CorporateActionIngestionDeps = {
  fetchEvents: getCorporateActions,
  loadCompanyIds,
  upsertRows: upsertCorporateActions,
  startRun: startIngestionRun,
  completeRun: completeIngestionRun,
  pushToDLQ,
  now: () => new Date(),
};

class WriteFailedError extends Error {}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCorporateActionIngestion(
  options: CorporateActionIngestionOptions,
  deps: CorporateActionIngestionDeps = corporateActionIngestionDeps,
): Promise<CorporateActionIngestionResult> {
  const log = getLogger("pipeline:corporate-actions");
  const startedAt = deps.now();
  const runId = `corporate-actions-${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const resolved = [...new Map(
    (options.symbols ?? TRACKED_CORPORATE_ACTION_SYMBOLS).map((input) => {
      const market = resolveMarketSymbol(input);
      return [market.symbol, market] as const;
    }),
  ).values()];
  const symbols = resolved.map((market) => market.symbol);
  const dryRun = options.dryRun ?? false;

  const result: CorporateActionIngestionResult = {
    runId,
    status: "success",
    symbolsAttempted: resolved.length,
    symbolsSucceeded: 0,
    symbolsFailed: 0,
    failures: [],
    eventsFetched: 0,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    recordsRejected: 0,
    durationMs: 0,
  };

  if (!dryRun) {
    await deps.startRun({
      runId,
      source: CORPORATE_ACTION_RUN_SOURCE,
      pipeline: CORPORATE_ACTION_PIPELINE,
      metadata: { trigger: options.trigger, symbols },
    });
  }

  let fatal: unknown;
  try {
    const companyIds = await deps.loadCompanyIds(symbols);
    for (let index = 0; index < resolved.length; index += MAX_CONCURRENT) {
      const batch = resolved.slice(index, index + MAX_CONCURRENT);
      const settled = await Promise.allSettled(batch.map(async ({ symbol, ticker }) => {
        const events = await deps.fetchEvents(ticker);
        const mapped = mapCorporateActions(symbol, ticker, events);
        const companyId = companyIds.has(symbol) ? symbol : null;
        const rows = mapped.rows.map((row) => ({ ...row, companyId }));
        const counts = dryRun
          ? { inserted: 0, updated: 0, unchanged: 0 }
          : await deps.upsertRows(rows).catch((error: unknown) => {
            throw new WriteFailedError(errorText(error));
          });
        if (mapped.rejected.length > 0) log.warn({ symbol, rejected: mapped.rejected }, "corporate actions not stored");
        return { events: events.length, rejected: mapped.rejected.length, ...counts };
      }));

      for (let item = 0; item < settled.length; item++) {
        const outcome = settled[item]!;
        const { symbol } = batch[item]!;
        if (outcome.status === "fulfilled") {
          result.symbolsSucceeded++;
          result.eventsFetched += outcome.value.events;
          result.recordsInserted += outcome.value.inserted;
          result.recordsUpdated += outcome.value.updated;
          result.recordsUnchanged += outcome.value.unchanged;
          result.recordsRejected += outcome.value.rejected;
          continue;
        }
        const error = errorText(outcome.reason);
        result.symbolsFailed++;
        result.failures.push({ symbol, error });
        log.warn({ symbol, err: error }, "corporate actions ingestion failed for symbol");
        if (!dryRun) {
          await deps.pushToDLQ({
            source: CORPORATE_ACTION_RUN_SOURCE,
            pipeline: CORPORATE_ACTION_PIPELINE,
            batchId: runId,
            symbol,
            errorCode: outcome.reason instanceof WriteFailedError
              ? "WRITE_FAILED"
              : "FETCH_FAILED",
            errorMessage: error,
          });
        }
      }
    }
  } catch (error) {
    fatal = error;
  }

  result.status = fatal !== undefined || (result.symbolsAttempted > 0 && result.symbolsSucceeded === 0)
    ? "failed"
    : result.symbolsFailed > 0 ? "partial" : "success";
  result.durationMs = deps.now().getTime() - startedAt.getTime();

  if (!dryRun) {
    const errorMessage = fatal !== undefined
      ? errorText(fatal)
      : result.failures.length > 0
        ? result.failures.slice(0, 5).map((failure) => `${failure.symbol}: ${failure.error}`).join("; ")
        : undefined;
    await deps.completeRun({
      runId,
      status: result.status,
      symbolsAttempted: result.symbolsAttempted,
      symbolsSucceeded: result.symbolsSucceeded,
      symbolsFailed: result.symbolsFailed,
      recordsInserted: result.recordsInserted,
      recordsUpdated: result.recordsUpdated,
      recordsRejected: result.recordsRejected,
      errorMessage: errorMessage?.slice(0, 500),
      startedAt,
    });
  }
  log.info({ ...result, failures: result.failures.length }, "corporate actions ingestion finished");
  if (fatal !== undefined) throw fatal;
  return result;
}
