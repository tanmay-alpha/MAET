/**
 * Technical Snapshot Worker
 *
 * Computes canonical technical snapshots for symbols across the equity universe.
 * Pipeline:
 *   Historical Candles (Database or Provider)
 *        ↓
 *   Canonical Indicator Engine (@shared/indicators)
 *        ↓
 *   Technical Snapshot Worker
 *        ↓
 *   PostgreSQL technical_snapshots table
 *        ↓
 *   High-Performance Screener
 */

import { db } from "../data/drizzle/client";
import { candles, companies } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { technicalSnapshotService } from "../modules/technical-snapshots/service";
import { getCandles } from "../data/sources/yahoo";
import { resolveMarketSymbol } from "../domain/market/symbol";
import type { Candle } from "@shared/types";

function getLog() {
  try {
    return require("../infra/logger").getLogger().child({ worker: "technical-snapshot-worker" });
  } catch {
    return {
      info: (...args: unknown[]) => console.log("[technical-snapshot-worker]", ...args),
      warn: (...args: unknown[]) => console.warn("[technical-snapshot-worker]", ...args),
      error: (...args: unknown[]) => console.error("[technical-snapshot-worker]", ...args),
    };
  }
}

export interface SnapshotWorkerOptions {
  symbols?: string[];
  timeframe?: string;
  batchSize?: number;
  fetchIfMissing?: boolean;
}

export async function runTechnicalSnapshotPipeline(options: SnapshotWorkerOptions = {}) {
  const log = getLog();
  const timeframe = options.timeframe || "1d";
  const batchSize = options.batchSize || 10;
  const fetchIfMissing = options.fetchIfMissing ?? true;

  let targetSymbols = options.symbols;

  if (!targetSymbols || targetSymbols.length === 0) {
    try {
      const rows = await db
        .select({ symbol: companies.symbol })
        .from(companies)
        .where(eq(companies.isActive, true))
        .limit(500);
      targetSymbols = rows.map((r) => r.symbol);
    } catch (e) {
      log.warn({ error: (e as Error).message }, "Failed to fetch companies from DB, using defaults");
      targetSymbols = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "ITC", "BHARTIARTL"];
    }
  }

  log.info({ totalSymbols: targetSymbols.length, timeframe }, "Starting technical snapshot pipeline");

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < targetSymbols.length; i += batchSize) {
    const chunk = targetSymbols.slice(i, i + batchSize);

    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          // 1. Fetch candles from database
          const dbRows = await db
            .select()
            .from(candles)
            .where(and(eq(candles.symbol, symbol.toUpperCase()), eq(candles.timeframe, timeframe)))
            .orderBy(desc(candles.ts))
            .limit(300);

          let candleList: Candle[] = dbRows.reverse().map((c) => ({
            symbol: c.symbol,
            tf: c.timeframe as any,
            ts: c.ts.toISOString(),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 0),
            source: c.source,
          }));

          // 2. If DB has insufficient history and fetchIfMissing is true, try Yahoo
          if (candleList.length < 20 && fetchIfMissing) {
            try {
              const yahooIdentity = resolveMarketSymbol(symbol);
              const now = new Date();
              const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);
              const yahooCandles = await getCandles(yahooIdentity.ticker, oneYearAgo, now, "1d");
              if (yahooCandles.length > 0) {
                candleList = yahooCandles;
              }
            } catch (yErr) {
              // Ignore Yahoo fetch errors, use whatever candle data we have
            }
          }

          if (candleList.length === 0) {
            return;
          }

          // 3. Compute and store canonical technical snapshot
          await technicalSnapshotService.computeAndStoreSnapshot(symbol, candleList, timeframe);
          succeeded++;
        } catch (err) {
          failed++;
          log.warn({ symbol, error: (err as Error).message }, "Failed to compute technical snapshot");
        } finally {
          processed++;
        }
      })
    );
  }

  log.info({ processed, succeeded, failed }, "Completed technical snapshot pipeline");
  return { processed, succeeded, failed };
}
