import {
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { placePaperOrderInAccount } from "@shared/domain/paper-trading/execution";
import type { ExecutionQuote } from "@shared/types";
import {
  EMPTY_ACCOUNT,
  getPaperAccount,
  parseStoredPaperAccount,
  placePaperOrder,
  resetPaperAccount,
  settlePaperOrders,
} from "./use-paper-account";

function liveQuote(
  symbol: string,
  price: number,
  overrides: Partial<ExecutionQuote> = {}
): ExecutionQuote {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume: 1000,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
    ...overrides,
  };
}

describe("paper order runtime boundary", () => {
  beforeEach(() => {
    resetPaperAccount();
  });

  it("rejects a MARKET order without a quote", () => {
    const result = placePaperOrderInAccount(
      EMPTY_ACCOUNT,
      {
        type: "MARKET",
        symbol: "RELIANCE",
        side: "BUY",
        quantity: 10,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/quote|required/i);
  });

  it("rejects runtime marketPrice and malformed quantity fields", () => {
    const withMarketPrice = placePaperOrderInAccount(
      EMPTY_ACCOUNT,
      {
        type: "MARKET",
        symbol: "RELIANCE",
        side: "BUY",
        quantity: 10,
        quote: liveQuote("RELIANCE", 2500),
        marketPrice: 2500,
      }
    );
    expect(withMarketPrice.ok).toBe(false);
    expect(withMarketPrice.message).toContain("marketPrice");

    for (const quantity of [0, -5, 10.5]) {
      const result = placePaperOrderInAccount(
        EMPTY_ACCOUNT,
        {
          type: "MARKET",
          symbol: "RELIANCE",
          side: "BUY",
          quantity,
          quote: liveQuote("RELIANCE", 2500),
        }
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain(
        "Quantity must be a positive whole number"
      );
    }
  });

  it("rejects stale, synthetic, delayed, and mismatched quotes", () => {
    const invalidQuotes = [
      liveQuote("RELIANCE", 2500, {
        ts: new Date(
          Date.now() - 15_000
        ).toISOString(),
      }),
      liveQuote("RELIANCE", 2500, {
        source: "simulated",
        quality: "synthetic",
      }),
      liveQuote("RELIANCE", 2500, {
        source: "yahoo",
        quality: "delayed",
      }),
      liveQuote("TCS", 2500),
    ];

    for (const quote of invalidQuotes) {
      const result = placePaperOrder({
        type: "MARKET",
        symbol: "RELIANCE",
        side: "BUY",
        quantity: 10,
        quote,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("fills a fresh live MARKET order with domain slippage", () => {
    const result = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote: liveQuote("RELIANCE", 2500),
    });

    expect(result.ok).toBe(true);
    const current = getPaperAccount();
    expect(current.fills).toHaveLength(1);
    expect(current.fills[0].fillPrice).toBeGreaterThan(2500);
  });

  it("queues LIMIT and STOP_LOSS_LIMIT without a quote", () => {
    const limit = placePaperOrder({
      type: "LIMIT",
      symbol: "TCS",
      side: "BUY",
      quantity: 5,
      limitPrice: 3500,
    });
    const stopLimit = placePaperOrder({
      type: "STOP_LOSS_LIMIT",
      symbol: "HDFCBANK",
      side: "SELL",
      quantity: 5,
      stopPrice: 1400,
      limitPrice: 1395,
    });

    expect(limit.ok).toBe(true);
    expect(stopLimit.ok).toBe(true);
  });

  it("does not use timestamp or provenance fallbacks during settlement", () => {
    placePaperOrder({
      type: "LIMIT",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      limitPrice: 2500,
    });

    const incompleteQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2400,
      volume: 1000,
      timestamp: new Date().toISOString(),
    };
    settlePaperOrders(
      new Map([
        ["RELIANCE", incompleteQuote],
      ]) as Map<string, ExecutionQuote>
    );

    const current = getPaperAccount();
    expect(current.orders[0].status).toBe("PENDING");
    expect(current.fills).toHaveLength(0);
  });
});

describe("localStorage V2 to V3 validation", () => {
  const validV3 = JSON.stringify(EMPTY_ACCOUNT);

  const legacy = {
    version: 2,
    initialCash: 100_000,
    cash: 90_000,
    isLocked: false,
    positions: [
      {
        symbol: "RELIANCE",
        qty: 10,
        avgPrice: 1000,
      },
    ],
    orders: [],
  };

  it("loads a valid V3 account", () => {
    const result = parseStoredPaperAccount(validV3, null);
    expect(result.source).toBe("v3");
    expect(result.account).toEqual(EMPTY_ACCOUNT);
  });

  it("migrates a valid V2 account and validates the V3 result", () => {
    const result = parseStoredPaperAccount(
      null,
      JSON.stringify(legacy)
    );
    expect(result.source).toBe("legacy-v2-key");
    expect(result.account.version).toBe(3);
    expect(result.account.positions[0]).toMatchObject({
      symbol: "RELIANCE",
      quantity: 10,
      averagePrice: 1000,
    });
    expect(result.account.fills).toEqual([]);
  });

  it("uses EMPTY_ACCOUNT for corrupted JSON or invalid schemas", () => {
    const corrupted = parseStoredPaperAccount("{bad", null);
    const invalid = parseStoredPaperAccount(
      JSON.stringify({
        version: 3,
        cash: "not-a-number",
        positions: [],
      }),
      null
    );

    expect(corrupted.source).toBe("invalid");
    expect(corrupted.account).toEqual(EMPTY_ACCOUNT);
    expect(invalid.source).toBe("invalid");
    expect(invalid.account).toEqual(EMPTY_ACCOUNT);
  });

  it("maps locked legacy accounts by whether positions remain", () => {
    const withPositions = parseStoredPaperAccount(
      null,
      JSON.stringify({
        ...legacy,
        isLocked: true,
      })
    );
    const withoutPositions = parseStoredPaperAccount(
      null,
      JSON.stringify({
        ...legacy,
        isLocked: true,
        positions: [],
      })
    );

    expect(withPositions.account.status).toBe(
      "LIQUIDATION_PENDING"
    );
    expect(withoutPositions.account.status).toBe(
      "LIQUIDATED"
    );
  });
});
