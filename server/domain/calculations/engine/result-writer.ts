/**
 * Result Writer — Write computed indicator results to Supabase + BigQuery
 */

import { getLogger } from "../../../infra/logger";
import { coordinateIndicatorWrite } from "../../workers/ingestion-engine/writers/write-coordinator";
import type { CalculatorOutput } from "./calculator-registry";
import type { BatchRunResult } from "./batch-runner";

const logger = getLogger("result-writer");

export async function writeResults(
  batchResults: BatchRunResult[],
  date: string,
  pipeline = "daily"
): Promise<void> {
  const indicatorRows = batchResults
    .filter((r) => !r.error && r.outputs.length > 0)
    .flatMap((r) =>
      r.outputs.map((o: CalculatorOutput) => ({
        symbol: o.symbol,
        date: o.date || date,
        indicatorName: o.indicatorName,
        indicatorValue: o.value,
        indicatorSignal: o.signal ?? null,
        indicatorHist: o.hist ?? null,
        timeframe: "1d",
        parameters: o.metadata as Record<string, unknown> | undefined,
      }))
    );

  if (indicatorRows.length === 0) {
    logger.info("No indicator rows to write");
    return;
  }

  const result = await coordinateIndicatorWrite(indicatorRows, "calculation-engine", pipeline);

  logger.info(
    {
      rows: indicatorRows.length,
      supabaseInserted: result.supabase.inserted,
      bqStreamed: result.bigquery.rowsStreamed,
      durationMs: result.totalDurationMs,
    },
    "Results written"
  );
}
