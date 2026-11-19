import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { closeDb, getSqlClient } from "../../data/drizzle/client";
import { loadMarketCandles } from "../../domain/market/candle-service";
import { dailyPipelineDependencies, runDailyPipeline } from "./pipelines/daily-pipeline";
import { toOHLCVRows } from "./sources/yahoo-history";

// Not in the Nifty list, so resolveMarketSymbol keeps it verbatim.
const SYMBOL = "ZZINGESTTEST";
const SESSIONS = ["2020-01-06", "2020-01-07", "2020-01-08", "2020-01-09"];
// Yahoo stamps NSE daily bars at the 09:15 IST session open.
const sessionTs = (day: string) => `${day}T03:45:00.000Z`;

function providerCandle(day: string, close: number): Candle {
  return { symbol: SYMBOL, tf: "1d", ts: sessionTs(day), open: close - 1, high: close + 2, low: close - 3, close, volume: 1_000 };
}

const providerCandles: Candle[] = [
  ...SESSIONS.map((day, index) => providerCandle(day, 100 + index)),
  // Inverted range: must be rejected and counted, never stored.
  { ...providerCandle("2020-01-10", 110), high: 90 },
];

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
const bigQueryEnv = ["BIGQUERY_PROJECT", "GOOGLE_CLOUD_PROJECT", "BIGQUERY_DATASET"] as const;
const savedBigQueryEnv: Partial<Record<(typeof bigQueryEnv)[number], string>> = {};
const runIds: string[] = [];

async function ingest() {
  const result = await runDailyPipeline({ symbols: [SYMBOL] }, {
    ...dailyPipelineDependencies,
    // Only the network call is replaced; mapping, validation and writes are real.
    fetchHistory: async ({ symbols }) => symbols.map((symbol) => ({ symbol, rows: toOHLCVRows(symbol, providerCandles) })),
  });
  runIds.push(result.runId);
  return result;
}

describe.skipIf(!hasDatabase)("daily ingestion pipeline → candles (PostgreSQL)", () => {
  beforeAll(async () => {
    // Keep the optional BigQuery fan-out off the network.
    for (const key of bigQueryEnv) {
      savedBigQueryEnv[key] = process.env[key];
      delete process.env[key];
    }
    await getSqlClient()`DELETE FROM candles WHERE symbol = ${SYMBOL}`;
  });

  afterAll(async () => {
    const sql = getSqlClient();
    await sql`DELETE FROM candles WHERE symbol = ${SYMBOL}`;
    if (runIds.length > 0) await sql`DELETE FROM ingestion_runs WHERE batch_id IN ${sql(runIds)}`;
    for (const key of bigQueryEnv) {
      if (savedBigQueryEnv[key] !== undefined) process.env[key] = savedBigQueryEnv[key];
    }
    await closeDb();
  });

  it("makes accepted bars visible to the chart candle reader and counts rejected bars on the run", async () => {
    const result = await ingest();
    expect(result).toMatchObject({ status: "success", recordsInserted: SESSIONS.length, validationRejected: 1 });

    const loaded = await loadMarketCandles(
      SYMBOL,
      "1d",
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2020-01-10T00:00:00.000Z"),
    );
    expect(loaded.source).toBe("database");
    expect(loaded.candles).toEqual(SESSIONS.map((day, index) => ({
      symbol: SYMBOL,
      tf: "1d",
      ts: sessionTs(day),
      open: 99 + index,
      high: 102 + index,
      low: 97 + index,
      close: 100 + index,
      volume: 1_000,
    })));

    const [run] = await getSqlClient()`
      SELECT status, attempted, failed, inserted, metadata
      FROM ingestion_runs WHERE batch_id = ${result.runId}
    `;
    expect(run).toMatchObject({ status: "succeeded", attempted: 1, failed: 0, inserted: SESSIONS.length });
    expect(run!.metadata).toEqual({ recordsRejected: 1 });
  });

  it("overwrites a bar the candle service already stored for the same session instead of duplicating it", async () => {
    const sql = getSqlClient();
    await sql`
      UPDATE candles SET close = 1, source = 'stale'
      WHERE symbol = ${SYMBOL} AND timeframe = '1d' AND ts = ${sessionTs(SESSIONS[0]!)}::timestamptz
    `;

    await ingest();

    const rows = await sql`
      SELECT ts, close::float8 AS close, source FROM candles
      WHERE symbol = ${SYMBOL} AND timeframe = '1d' ORDER BY ts
    `;
    expect(rows).toHaveLength(SESSIONS.length);
    expect(rows[0]).toMatchObject({ close: 100, source: "yahoo" });
  });
});
