import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  TickSchema,
  CandleSchema,
  QuoteSchema,
  OrderSchema,
  FillSchema,
  PositionSchema,
  CriterionSchema,
  ScreenerSchema,
  ErrorCodeSchema,
  ErrorCode,
} from "./index";

describe("shared types", () => {
  it("round-trips a Tick", () => {
    const tick = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500.5,
      volume: 1000,
      ts: new Date().toISOString(),
    };
    expect(TickSchema.parse(tick)).toEqual(tick);
  });

  it("round-trips a Candle", () => {
    const candle = {
      symbol: "RELIANCE",
      tf: "1d",
      ts: "2026-01-01T00:00:00.000Z",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 10000,
    };
    expect(CandleSchema.parse(candle)).toEqual(candle);
  });

  it("rejects a negative price on Tick", () => {
    expect(() => TickSchema.parse({ exchange: "NSE", symbol: "X", price: -1, volume: 0, ts: new Date().toISOString() })).toThrow();
  });

  it("round-trips an Order", () => {
    const order = {
      id: "ord-1",
      userId: "u-1",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      status: "pending",
      idempotencyKey: "k-1",
      placedAt: new Date().toISOString(),
    };
    expect(OrderSchema.parse(order)).toEqual(order);
  });

  it("validates an ErrorCode union value", () => {
    const ok: ErrorCode = ErrorCodeSchema.parse("RATE_LIMITED");
    expect(ok).toBe("RATE_LIMITED");
    expect(() => ErrorCodeSchema.parse("BOGUS")).toThrow();
  });

  it("round-trips a Criterion (PE < 30)", () => {
    const c = { field: "pe", op: "lt", value: 30 };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("round-trips a Screener", () => {
    const s = {
      id: "scr-1",
      userId: "u-1",
      name: "value",
      exchange: "NSE",
      criteria: { op: "AND", children: [{ field: "pe", op: "lt", value: 30 }] },
      isActive: true,
    };
    expect(ScreenerSchema.parse(s)).toEqual(s);
  });
});
