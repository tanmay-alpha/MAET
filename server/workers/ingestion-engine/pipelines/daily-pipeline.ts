/**
 * Daily Pipeline — Post-market daily bar processing
 * Fetches Yahoo daily OHLCV, validates every bar, and upserts accepted bars
 * into `candles` (timeframe '1d') — the table charts, screener, breadth and
 * backtests read — with an optional BigQuery copy.
 */

import { getLogger } from "../../../infra/logger";
import { validateDailyBars } from "../validators/schema-validator";
import { coordinateOHLCVWrite } from "../writers/write-coordinator";
import { pushToDLQ } from "../queue/dead-letter-queue";
import { startIngestionRun, completeIngestionRun } from "../writers/supabase-writer";
import * as YahooHistory from "../sources/yahoo-history";

const logger = getLogger("pipeline:daily");
const TIMEFRAME = "1d";

export interface DailyPipelineOptions {
  symbols: string[];
  backfillDays?: number;
  dryRun?: boolean;
}

export interface DailyPipelineResult {
  runId: string;
  status: "success" | "partial" | "failed";
  symbolsAttempted: number;
  symbolsSucceeded: number;
  symbolsFailed: number;
  recordsInserted: number;
  validationRejected: number;
  dlqPushed: number;
  durationMs: number;
}

export type DailyPipelineDependencies = {
  fetchHistory: typeof YahooHistory.fetch;
  writeBars: typeof coordinateOHLCVWrite;
  startRun: typeof startIngestionRun;
  completeRun: typeof completeIngestionRun;
  pushToDLQ: typeof pushToDLQ;
};

export const dailyPipelineDependencies: DailyPipelineDependencies = {
  fetchHistory: YahooHistory.fetch,
  writeBars: coordinateOHLCVWrite,
  startRun: startIngestionRun,
  completeRun: completeIngestionRun,
  pushToDLQ,
};

export async function runDailyPipeline(
  opts: DailyPipelineOptions,
  deps: DailyPipelineDependencies = dailyPipelineDependencies,
): Promise<DailyPipelineResult> {
  const runId = `daily-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startedAt = new Date();
  logger.info({ runId, symbols: opts.symbols.length }, "Daily pipeline starting");

  const result: DailyPipelineResult = {
    runId,
    status: "success",
    symbolsAttempted: opts.symbols.length,
    symbolsSucceeded: 0,
    symbolsFailed: 0,
    recordsInserted: 0,
    validationRejected: 0,
    dlqPushed: 0,
    durationMs: 0,
  };

  if (!opts.dryRun) {
    await deps.startRun({ runId, source: "yahoo-history", pipeline: "daily" });
  }

  // Step 1: Fetch OHLCV from Yahoo
  const fetchResults = await deps.fetchHistory({
    symbols: opts.symbols,
    timeframes: [TIMEFRAME],
    backfillDays: opts.backfillDays ?? 365,
  });

  // Step 2: Validate + write each symbol
  for (const fr of fetchResults) {
    if (fr.error) {
      result.symbolsFailed++;
      await deps.pushToDLQ({
        source: "yahoo-history",
        pipeline: "daily",
        batchId: runId,
        symbol: fr.symbol,
        errorCode: "FETCH_FAILED",
        errorMessage: fr.error,
      });
      result.dlqPushed++;
      continue;
    }

    if (fr.rows.length === 0) {
      result.symbolsFailed++;
      continue;
    }

    const { valid, rejected } = validateDailyBars(fr.rows);
    result.validationRejected += rejected.length;
    if (rejected.length > 0) {
      logger.warn(
        { symbol: fr.symbol, rejected: rejected.length, sample: rejected.slice(0, 3) },
        "Daily bars rejected by validation",
      );
    }

    if (valid.length === 0) {
      result.symbolsFailed++;
      continue;
    }

    if (!opts.dryRun) {
      try {
        const writeResult = await deps.writeBars(valid, "yahoo-history", "daily", TIMEFRAME, runId);
        result.recordsInserted += writeResult.supabase.inserted;

        if (writeResult.supabase.failed > 0) {
          await deps.pushToDLQ({
            source: "yahoo-history",
            pipeline: "daily",
            batchId: runId,
            symbol: fr.symbol,
            errorCode: "WRITE_FAILED",
            errorMessage: `${writeResult.supabase.failed} rows failed to write to candles`,
            rawPayload: { rowCount: valid.length },
          });
          result.dlqPushed++;
        }
      } catch (err) {
        logger.error({ err, symbol: fr.symbol }, "Write coordinator failed");
        result.symbolsFailed++;
        continue;
      }
    }

    result.symbolsSucceeded++;
  }

  result.durationMs = Date.now() - startedAt.getTime();
  result.status = result.symbolsFailed === 0 ? "success" : result.symbolsSucceeded > 0 ? "partial" : "failed";

  if (!opts.dryRun) {
    await deps.completeRun({
      runId,
      status: result.status,
      symbolsAttempted: result.symbolsAttempted,
      symbolsSucceeded: result.symbolsSucceeded,
      symbolsFailed: result.symbolsFailed,
      recordsInserted: result.recordsInserted,
      recordsRejected: result.validationRejected,
      startedAt,
    });
  }

  logger.info(
    result,
    `Daily pipeline complete: ${result.symbolsSucceeded}/${result.symbolsAttempted} symbols, ${result.recordsInserted} records inserted, ${result.validationRejected} rejected`
  );

  return result;
}
