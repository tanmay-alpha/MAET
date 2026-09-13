/**
 * Technical Snapshots Service
 * Manages storage and retrieval of pre-computed technical indicators across symbols.
 */

import { db } from "../../data/drizzle/client";
import { technicalSnapshots } from "../../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { buildCanonicalSnapshot, INDICATOR_ENGINE_VERSION } from "@shared/indicators";
import type { Candle } from "@shared/types";

export interface TechnicalSnapshotRecord {
  id?: string;
  symbol: string;
  exchange?: string;
  timeframe?: string;
  asOf: Date;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  adx14: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  volume: number;
  averageVolume20: number | null;
  relativeVolume20: number | null;
  high20: number | null;
  low20: number | null;
  high52w: number | null;
  low52w: number | null;
  distanceFromSma20Pct: number | null;
  distanceFromSma50Pct: number | null;
  distanceFromSma200Pct: number | null;
  distanceFrom52WeekHighPct: number | null;
  distanceFrom52WeekLowPct: number | null;
  priceAboveSma20: boolean | null;
  priceAboveSma50: boolean | null;
  priceAboveSma200: boolean | null;
  indicatorEngineVersion?: string;
  sourceTimestamp?: Date;
}

export class TechnicalSnapshotService {
  /**
   * Compute a technical snapshot from candles and upsert into technical_snapshots
   */
  async computeAndStoreSnapshot(
    symbol: string,
    candles: Candle[],
    timeframe: string = "1d",
    exchange: string = "NSE"
  ) {
    if (!candles || candles.length === 0) return null;

    const snapshot = buildCanonicalSnapshot(candles);
    if (!snapshot) return null;

    const lastCandle = candles[candles.length - 1];
    const asOf = new Date(lastCandle.ts);

    return this.upsertSnapshot({
      symbol: symbol.toUpperCase(),
      exchange,
      timeframe,
      asOf,
      close: snapshot.close,
      sma20: snapshot.sma20,
      sma50: snapshot.sma50,
      sma200: snapshot.sma200,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      ema200: snapshot.ema200,
      rsi14: snapshot.rsi14,
      macd: snapshot.macd,
      macdSignal: snapshot.macdSignal,
      macdHistogram: snapshot.macdHistogram,
      atr14: snapshot.atr14,
      adx14: snapshot.adx14,
      bbUpper: snapshot.bbUpper,
      bbMiddle: snapshot.bbMiddle,
      bbLower: snapshot.bbLower,
      bbWidth: snapshot.bbWidth,
      volume: snapshot.volume,
      averageVolume20: snapshot.averageVolume20,
      relativeVolume20: snapshot.relativeVolume20,
      high20: snapshot.high20,
      low20: snapshot.low20,
      high52w: snapshot.high52w,
      low52w: snapshot.low52w,
      distanceFromSma20Pct: snapshot.distanceFromSma20Pct,
      distanceFromSma50Pct: snapshot.distanceFromSma50Pct,
      distanceFromSma200Pct: snapshot.distanceFromSma200Pct,
      distanceFrom52WeekHighPct: snapshot.distanceFrom52WeekHighPct,
      distanceFrom52WeekLowPct: snapshot.distanceFrom52WeekLowPct,
      priceAboveSma20: snapshot.priceAboveSma20,
      priceAboveSma50: snapshot.priceAboveSma50,
      priceAboveSma200: snapshot.priceAboveSma200,
      indicatorEngineVersion: INDICATOR_ENGINE_VERSION,
      sourceTimestamp: asOf,
    });
  }

  /**
   * Upsert a technical snapshot into the database
   */
  async upsertSnapshot(record: TechnicalSnapshotRecord) {
    const exchange = record.exchange || "NSE";
    const timeframe = record.timeframe || "1d";

    const insertValues = {
      symbol: record.symbol.toUpperCase(),
      exchange,
      timeframe,
      asOf: record.asOf,
      close: String(record.close),
      sma20: record.sma20 !== null ? String(record.sma20) : null,
      sma50: record.sma50 !== null ? String(record.sma50) : null,
      sma200: record.sma200 !== null ? String(record.sma200) : null,
      ema20: record.ema20 !== null ? String(record.ema20) : null,
      ema50: record.ema50 !== null ? String(record.ema50) : null,
      ema200: record.ema200 !== null ? String(record.ema200) : null,
      rsi14: record.rsi14 !== null ? String(record.rsi14) : null,
      macd: record.macd !== null ? String(record.macd) : null,
      macdSignal: record.macdSignal !== null ? String(record.macdSignal) : null,
      macdHistogram: record.macdHistogram !== null ? String(record.macdHistogram) : null,
      atr14: record.atr14 !== null ? String(record.atr14) : null,
      adx14: record.adx14 !== null ? String(record.adx14) : null,
      bbUpper: record.bbUpper !== null ? String(record.bbUpper) : null,
      bbMiddle: record.bbMiddle !== null ? String(record.bbMiddle) : null,
      bbLower: record.bbLower !== null ? String(record.bbLower) : null,
      bbWidth: record.bbWidth !== null ? String(record.bbWidth) : null,
      volume: record.volume,
      averageVolume20: record.averageVolume20,
      relativeVolume20: record.relativeVolume20 !== null ? String(record.relativeVolume20) : null,
      high20: record.high20 !== null ? String(record.high20) : null,
      low20: record.low20 !== null ? String(record.low20) : null,
      high52w: record.high52w !== null ? String(record.high52w) : null,
      low52w: record.low52w !== null ? String(record.low52w) : null,
      distanceFromSma20Pct: record.distanceFromSma20Pct !== null ? String(record.distanceFromSma20Pct) : null,
      distanceFromSma50Pct: record.distanceFromSma50Pct !== null ? String(record.distanceFromSma50Pct) : null,
      distanceFromSma200Pct: record.distanceFromSma200Pct !== null ? String(record.distanceFromSma200Pct) : null,
      distanceFrom52WeekHighPct: record.distanceFrom52WeekHighPct !== null ? String(record.distanceFrom52WeekHighPct) : null,
      distanceFrom52WeekLowPct: record.distanceFrom52WeekLowPct !== null ? String(record.distanceFrom52WeekLowPct) : null,
      priceAboveSma20: record.priceAboveSma20,
      priceAboveSma50: record.priceAboveSma50,
      priceAboveSma200: record.priceAboveSma200,
      indicatorEngineVersion: record.indicatorEngineVersion || INDICATOR_ENGINE_VERSION,
      sourceTimestamp: record.sourceTimestamp || record.asOf,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(technicalSnapshots)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [technicalSnapshots.symbol, technicalSnapshots.exchange, technicalSnapshots.timeframe],
        set: {
          asOf: insertValues.asOf,
          close: insertValues.close,
          sma20: insertValues.sma20,
          sma50: insertValues.sma50,
          sma200: insertValues.sma200,
          ema20: insertValues.ema20,
          ema50: insertValues.ema50,
          ema200: insertValues.ema200,
          rsi14: insertValues.rsi14,
          macd: insertValues.macd,
          macdSignal: insertValues.macdSignal,
          macdHistogram: insertValues.macdHistogram,
          atr14: insertValues.atr14,
          adx14: insertValues.adx14,
          bbUpper: insertValues.bbUpper,
          bbMiddle: insertValues.bbMiddle,
          bbLower: insertValues.bbLower,
          bbWidth: insertValues.bbWidth,
          volume: insertValues.volume,
          averageVolume20: insertValues.averageVolume20,
          relativeVolume20: insertValues.relativeVolume20,
          high20: insertValues.high20,
          low20: insertValues.low20,
          high52w: insertValues.high52w,
          low52w: insertValues.low52w,
          distanceFromSma20Pct: insertValues.distanceFromSma20Pct,
          distanceFromSma50Pct: insertValues.distanceFromSma50Pct,
          distanceFromSma200Pct: insertValues.distanceFromSma200Pct,
          distanceFrom52WeekHighPct: insertValues.distanceFrom52WeekHighPct,
          distanceFrom52WeekLowPct: insertValues.distanceFrom52WeekLowPct,
          priceAboveSma20: insertValues.priceAboveSma20,
          priceAboveSma50: insertValues.priceAboveSma50,
          priceAboveSma200: insertValues.priceAboveSma200,
          indicatorEngineVersion: insertValues.indicatorEngineVersion,
          sourceTimestamp: insertValues.sourceTimestamp,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  }

  /**
   * Get technical snapshot for a single symbol
   */
  async getSnapshot(symbol: string, timeframe: string = "1d", exchange: string = "NSE") {
    const [row] = await db
      .select()
      .from(technicalSnapshots)
      .where(
        and(
          eq(technicalSnapshots.symbol, symbol.toUpperCase()),
          eq(technicalSnapshots.exchange, exchange),
          eq(technicalSnapshots.timeframe, timeframe)
        )
      )
      .limit(1);

    return row ?? null;
  }

  /**
   * Get snapshots for multiple symbols
   */
  async getSnapshotsMap(symbols: string[], timeframe: string = "1d") {
    if (symbols.length === 0) return new Map();

    const upper = symbols.map((s) => s.toUpperCase());
    const rows = await db
      .select()
      .from(technicalSnapshots)
      .where(
        and(
          inArray(technicalSnapshots.symbol, upper),
          eq(technicalSnapshots.timeframe, timeframe)
        )
      );

    const map = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      map.set(row.symbol, row);
    }
    return map;
  }
}

export const technicalSnapshotService = new TechnicalSnapshotService();
