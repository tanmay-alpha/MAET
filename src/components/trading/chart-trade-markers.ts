/**
 * Chart Trade Markers
 * Maps backtest trades and execution fills to Lightweight Charts markers.
 */

import type { TradeMarkerData } from "./lightweight-chart";

export interface GenericTrade {
  id?: string;
  timestamp?: number | string | Date;
  time?: number | string | Date;
  entryTimestamp?: number | string | Date;
  exitTimestamp?: number | string | Date;
  side?: "BUY" | "SELL" | "LONG" | "SHORT" | "long" | "short" | "buy" | "sell";
  price?: number;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  qty?: number;
  pnl?: number;
  netPnl?: number;
  return?: number;
  status?: string;
  type?: string;
}

function parseTimestamp(val: unknown): number {
  if (typeof val === "number") return val > 1e11 ? val : val * 1000;
  if (typeof val === "string") {
    const parsed = new Date(val).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  if (val instanceof Date) return val.getTime();
  return Date.now();
}

/**
 * Maps an array of trade records or executions to chart marker data points.
 * Handles both pair trades (with entry and exit) and single fill events.
 */
export function mapTradesToChartMarkers(trades: GenericTrade[]): TradeMarkerData[] {
  if (!trades || trades.length === 0) return [];

  const markers: TradeMarkerData[] = [];

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tradeId = t.id || `trade-${i}`;

    // Case 1: Paired backtest trade with entry and exit
    if (t.entryTimestamp && t.entryPrice) {
      const isLong = String(t.side).toLowerCase().includes("long") || String(t.side).toLowerCase().includes("buy");
      // Entry marker
      markers.push({
        id: `${tradeId}-entry`,
        time: parseTimestamp(t.entryTimestamp),
        side: isLong ? "buy" : "sell",
        price: t.entryPrice,
        qty: t.quantity || t.qty,
        text: isLong ? `BUY @ ₹${t.entryPrice.toFixed(1)}` : `SHORT @ ₹${t.entryPrice.toFixed(1)}`,
      });

      // Exit marker if exited
      if (t.exitTimestamp && t.exitPrice) {
        const netPnl = t.netPnl !== undefined ? t.netPnl : t.pnl;
        markers.push({
          id: `${tradeId}-exit`,
          time: parseTimestamp(t.exitTimestamp),
          side: "exit",
          price: t.exitPrice,
          pnl: netPnl,
          text: netPnl !== undefined
            ? `EXIT: ${netPnl >= 0 ? "+" : ""}₹${netPnl.toFixed(1)}`
            : `EXIT @ ₹${t.exitPrice.toFixed(1)}`,
        });
      }
      continue;
    }

    // Case 2: Individual execution fill event
    const ts = parseTimestamp(t.timestamp || t.time);
    const sideStr = String(t.side || "").toUpperCase();
    const isBuy = sideStr === "BUY" || sideStr === "LONG";
    const isExit = t.type === "EXIT" || sideStr === "EXIT";

    if (isExit) {
      markers.push({
        id: tradeId,
        time: ts,
        side: "exit",
        price: t.price || 0,
        pnl: t.pnl ?? t.netPnl,
        text: `EXIT @ ₹${(t.price || 0).toFixed(1)}`,
      });
    } else {
      markers.push({
        id: tradeId,
        time: ts,
        side: isBuy ? "buy" : "sell",
        price: t.price || 0,
        qty: t.quantity || t.qty,
        text: `${isBuy ? "BUY" : "SELL"} @ ₹${(t.price || 0).toFixed(1)}`,
      });
    }
  }

  // Sort markers chronologically by time
  return markers.sort((a, b) => a.time - b.time);
}

/**
 * Maps backtest trade records to chart trade markers, optionally filtered by symbol.
 */
export function mapBacktestTradesToMarkers(trades: any[] = [], symbol?: string): TradeMarkerData[] {
  if (!trades || trades.length === 0) return [];
  const normSym = symbol?.trim().toUpperCase();
  const filtered = normSym
    ? trades.filter((t) => !t.symbol || t.symbol.trim().toUpperCase() === normSym)
    : trades;
  return mapTradesToChartMarkers(filtered);
}

/**
 * Maps paper execution fill records to chart trade markers, optionally filtered by symbol.
 */
export function mapFillsToTradeMarkers(fills: any[] = [], symbol?: string): TradeMarkerData[] {
  if (!fills || fills.length === 0) return [];
  const normSym = symbol?.trim().toUpperCase();
  const filtered = normSym
    ? fills.filter((f) => !f.symbol || f.symbol.trim().toUpperCase() === normSym)
    : fills;

  const genericTrades: GenericTrade[] = filtered.map((f, i) => ({
    id: f.id || `fill-${i}`,
    timestamp: f.executedAt || f.timestamp || f.createdAt,
    side: f.side,
    price: Number(f.price || f.fillPrice || 0),
    quantity: Number(f.quantity || f.shares || 0),
    type: f.orderType || f.type,
  }));

  return mapTradesToChartMarkers(genericTrades);
}
