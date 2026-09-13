import { describe, it, expect } from "bun:test";
import { extractPaperOverlay } from "./chart-paper-overlay";
import { mapBacktestTradesToMarkers, mapFillsToTradeMarkers } from "./chart-trade-markers";
import type { PaperPositionRow, PaperOrderRow } from "../../../server/modules/paper-trading/contracts";

describe("Chart Paper Overlay", () => {
  it("extracts long position with protective stop loss and take profit orders", () => {
    const positions: PaperPositionRow[] = [
      {
        id: "pos-1",
        userId: "u-1",
        symbol: "RELIANCE",
        exchange: "NSE",
        averageEntryPrice: "2500.0000",
        totalShares: 10,
        realizedPnl: "0.0000",
        unrealizedPnl: "450.0000",
        marginLocked: "25000.0000",
        side: "LONG",
        generation: 1,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ];

    const orders: PaperOrderRow[] = [
      {
        id: "ord-sl",
        userId: "u-1",
        symbol: "RELIANCE",
        side: "SELL",
        type: "STOP_LOSS_LIMIT",
        status: "PENDING",
        stopPrice: "2450.0000",
        limitPrice: "2445.0000",
      } as any,
      {
        id: "ord-tp",
        userId: "u-1",
        symbol: "RELIANCE",
        side: "SELL",
        type: "LIMIT",
        status: "PENDING",
        limitPrice: "2600.0000",
      } as any,
    ];

    const overlay = extractPaperOverlay("RELIANCE", positions, orders);
    expect(overlay).not.toBeNull();
    expect(overlay?.averageEntryPrice).toBe(2500);
    expect(overlay?.side).toBe("LONG");
    expect(overlay?.unrealizedPnL).toBe(450);
    expect(overlay?.stopLoss).toBe(2450);
    expect(overlay?.takeProfit).toBe(2600);
  });

  it("extracts short position with protective orders correctly", () => {
    const positions: PaperPositionRow[] = [
      {
        id: "pos-2",
        userId: "u-1",
        symbol: "TCS",
        exchange: "NSE",
        averageEntryPrice: "3800.0000",
        totalShares: 5,
        realizedPnl: "0.0000",
        unrealizedPnl: "-200.0000",
        marginLocked: "19000.0000",
        side: "SHORT",
        generation: 1,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ];

    const orders: PaperOrderRow[] = [
      {
        id: "ord-sl",
        userId: "u-1",
        symbol: "TCS",
        side: "BUY",
        type: "STOP_LOSS_LIMIT",
        status: "PENDING",
        stopPrice: "3850.0000",
      } as any,
      {
        id: "ord-tp",
        userId: "u-1",
        symbol: "TCS",
        side: "BUY",
        type: "LIMIT",
        status: "PENDING",
        limitPrice: "3700.0000",
      } as any,
    ];

    const overlay = extractPaperOverlay("TCS", positions, orders);
    expect(overlay).not.toBeNull();
    expect(overlay?.averageEntryPrice).toBe(3800);
    expect(overlay?.side).toBe("SHORT");
    expect(overlay?.stopLoss).toBe(3850);
    expect(overlay?.takeProfit).toBe(3700);
  });

  it("returns null when no position or pending orders match symbol", () => {
    const overlay = extractPaperOverlay("INFY", [], []);
    expect(overlay).toBeNull();
  });
});

describe("Chart Trade Markers", () => {
  it("maps paired backtest trades into entry and exit markers", () => {
    const backtestTrades = [
      {
        id: "bt-trade-1",
        symbol: "RELIANCE",
        side: "BUY",
        entryPrice: 2400,
        entryTimestamp: "2026-01-10T10:00:00.000Z",
        exitPrice: 2520,
        exitTimestamp: "2026-01-15T15:00:00.000Z",
        quantity: 25,
        netPnl: 3000,
      },
    ];

    const markers = mapBacktestTradesToMarkers(backtestTrades, "RELIANCE");
    expect(markers.length).toBe(2);

    const entry = markers[0];
    expect(entry.id).toBe("bt-trade-1-entry");
    expect(entry.side).toBe("buy");
    expect(entry.price).toBe(2400);
    expect(entry.text).toContain("BUY @ ₹2400.0");

    const exit = markers[1];
    expect(exit.id).toBe("bt-trade-1-exit");
    expect(exit.side).toBe("exit");
    expect(exit.price).toBe(2520);
    expect(exit.pnl).toBe(3000);
    expect(exit.text).toContain("+₹3000.0");
  });

  it("filters backtest trades by symbol", () => {
    const backtestTrades = [
      { id: "t-1", symbol: "RELIANCE", side: "BUY", entryPrice: 2400, entryTimestamp: 1700000000000 },
      { id: "t-2", symbol: "TCS", side: "BUY", entryPrice: 3500, entryTimestamp: 1700000000000 },
    ];

    const markers = mapBacktestTradesToMarkers(backtestTrades, "TCS");
    expect(markers.length).toBe(1);
    expect(markers[0].id).toBe("t-2-entry");
  });

  it("maps execution fills into trade markers", () => {
    const fills = [
      {
        id: "fill-1",
        symbol: "INFY",
        side: "BUY",
        fillPrice: "1850.50",
        quantity: 50,
        executedAt: "2026-02-01T09:30:00.000Z",
      },
      {
        id: "fill-2",
        symbol: "INFY",
        side: "SELL",
        fillPrice: "1890.00",
        quantity: 50,
        executedAt: "2026-02-02T14:30:00.000Z",
      },
    ];

    const markers = mapFillsToTradeMarkers(fills, "INFY");
    expect(markers.length).toBe(2);
    expect(markers[0].side).toBe("buy");
    expect(markers[0].price).toBe(1850.5);
    expect(markers[1].side).toBe("sell");
    expect(markers[1].price).toBe(1890);
  });
});
