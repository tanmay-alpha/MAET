import { describe, expect, test } from "bun:test";
import { buildClosePositionOrder } from "./paper-orders";

describe("buildClosePositionOrder", () => {
  test("closes a BSE position on BSE", () => {
    expect(
      buildClosePositionOrder({ symbol: "RELIANCE", exchange: "BSE", side: "LONG", totalShares: 15 })
    ).toEqual({ type: "MARKET", symbol: "RELIANCE", exchange: "BSE", side: "SELL", quantity: 15 });
  });

  test("buys back a short position", () => {
    expect(
      buildClosePositionOrder({ symbol: "TCS", exchange: "NSE", side: "SHORT", totalShares: 4 })
    ).toEqual({ type: "MARKET", symbol: "TCS", exchange: "NSE", side: "BUY", quantity: 4 });
  });

  test("refuses a position whose exchange cannot be traded", () => {
    expect(() =>
      buildClosePositionOrder({ symbol: "TCS", exchange: "MCX", side: "LONG", totalShares: 1 })
    ).toThrow();
  });
});
