/**
 * Daily Pipeline — Post-market daily bar processing
 * Orchestrates: NSE company sync → Yahoo OHLCV → Fundamentals → DLQ retry
 * Writes to both Supabase (operational) and BigQuery (analytical) simultaneously
 */

import { getLogger } from "../../../infra/logger";
import { validateOHLCVBatch, validateOHLCVRanges } from "../validators/schema-validator";
import { coordinateOHLCVWrite } from "../writers/write-coordinator";
import { pushToDLQ } from "../queue/dead-letter-queue";
import { startIngestionRun, completeIngestionRun } from "../writers/supabase-writer";
import * as YahooHistory from "../sources/yahoo-history";
import * as NSEEquities from "../sources/nse-equities";

const logger = getLogger("pipeline:daily");

export interface DailyPipelineOptions {
  symbols: string[];
  backfillDays?: number;
  syncFundamentals?: boolean;
  dryRun?: boolean;
}

export interface DailyPipelineResult {
  runId: string;
  symbolsAttempted: number;
  symbolsSucceeded: number;
  symbolsFailed: number;
  recordsInserted: number;
  validationRejected: number;
  dlqPushed: number;
  durationMs: number;
}

export async function runDailyPipeline(opts: DailyPipelineOptions): Promise<DailyPipelineResult> {
  const runId = `daily-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startedAt = new Date();
  logger.info({ runId, symbols: opts.symbols.length }, "Daily pipeline starting");

  const result: DailyPipelineResult = {
    runId,
    symbolsAttempted: opts.symbols.length,
    symbolsSucceeded: 0,
    symbolsFailed: 0,
    recordsInserted: 0,
    validationRejected: 0,
    dlqPushed: 0,
    durationMs: 0,
  };

  if (!opts.dryRun) {
    await startIngestionRun({ runId, source: "yahoo-history", pipeline: "daily" });
  }

  // Step 1: Fetch OHLCV from Yahoo
  const fetchResults = await YahooHistory.fetch({
    symbols: opts.symbols,
    timeframes: ["1d"],
    backfillDays: opts.backfillDays ?? 365,
  });

  // Step 2: Validate + write each symbol
  for (const fr of fetchResults) {
    if (fr.error) {
      result.symbolsFailed++;
      await pushToDLQ({
        source: "yahoo-history",
        pipeline: "daily",
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

    // Schema validation
    const { valid: schemaValid, invalid: schemaInvalid } = validateOHLCVBatch(fr.rows);
    result.validationRejected += schemaInvalid.length;

    // Range validation
    const { valid: rangeValid, violations } = validateOHLCVRanges(schemaValid);
    result.validationRejected += schemaValid.length - rangeValid.length;

    if (violations.length > 0) {
      logger.warn({ symbol: fr.symbol, violations: violations.length }, "Range violations detected");
    }

    if (rangeValid.length === 0) {
      result.symbolsFailed++;
      continue;
    }

    if (!opts.dryRun) {
      try {
        const writeResult = await coordinateOHLCVWrite(rangeValid, "yahoo-history", "daily", "1d");
        result.recordsInserted += writeResult.supabase.inserted;

        if (writeResult.supabase.failed > 0) {
          await pushToDLQ({
            source: "yahoo-history",
            pipeline: "daily",
            symbol: fr.symbol,
            errorCode: "WRITE_FAILED",
            errorMessage: `${writeResult.supabase.failed} rows failed to write to Supabase`,
            rawPayload: { rowCount: rangeValid.length },
          });
          result.dlqPushed++;
        }
      } catch (err) {
        logger.error({ err, symbol: fr.symbol }, "Write coordinator failed");
        result.symbolsFailed++;
        result.dlqPushed++;
        continue;
      }
    }

    result.symbolsSucceeded++;
  }

  result.durationMs = Date.now() - startedAt.getTime();

  if (!opts.dryRun) {
    await completeIngestionRun({
      runId,
      status: result.symbolsFailed === 0 ? "success" : result.symbolsSucceeded > 0 ? "partial" : "failed",
      symbolsAttempted: result.symbolsAttempted,
      symbolsSucceeded: result.symbolsSucceeded,
      symbolsFailed: result.symbolsFailed,
      recordsInserted: result.recordsInserted,
      startedAt,
    });
  }

  logger.info(
    { runId, ...result },
    `Daily pipeline complete: ${result.symbolsSucceeded}/${result.symbolsAttempted} symbols, ${result.recordsInserted} records inserted`
  );

  return result;
}
