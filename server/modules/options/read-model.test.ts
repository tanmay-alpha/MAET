import { describe, expect, it } from "bun:test";
import type { OptionChainContractView } from "./contracts";
import {
  createLatestOptionChainResponse,
  normalizePersistedOptionExpiryDate,
  normalizePersistedOptionUnderlying,
  sortPersistedOptionExpiries,
} from "./read-model";

const callWithoutQuote: OptionChainContractView = {
  contractId: "call-contract",
  token: "101",
  tradingSymbol: "NIFTY28AUG2624500CE",
  strikePrice: "24500.0000",
  optionType: "CE",
  lotSize: 75,
  instrumentType: "OPTIDX",
  quote: null,
  greeks: {
    delta: "0.51000000",
    gamma: null,
    theta: null,
    vega: null,
    impliedVolatility: null,
    tradeVolume: null,
    observedAt: "2026-08-31T09:30:05.000Z",
    source: "angelone",
  },
};

const putWithQuote: OptionChainContractView = {
  contractId: "put-contract",
  token: "102",
  tradingSymbol: "NIFTY28AUG2624500PE",
  strikePrice: "24500.0000",
  optionType: "PE",
  lotSize: 75,
  instrumentType: "OPTIDX",
  quote: {
    ltp: null,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: 0,
    openInterest: 0,
    netChange: null,
    percentChange: null,
    averagePrice: null,
    totalBuyQuantity: null,
    totalSellQuantity: null,
    bestBidPrice: null,
    bestBidQuantity: null,
    bestAskPrice: null,
    bestAskQuantity: null,
    exchangeFeedAt: "2026-08-31T09:30:01.000Z",
    exchangeTradeAt: null,
    receivedAt: "2026-08-31T09:30:02.000Z",
    source: "angelone",
  },
  greeks: null,
};

describe("persisted option-chain read model", () => {
  it("normalizes an underlying and rejects an empty or impossible expiry date", () => {
    expect(normalizePersistedOptionUnderlying(" nifty ")).toBe("NIFTY");
    expect(normalizePersistedOptionExpiryDate("2026-08-28")).toBe("2026-08-28");
    expect(() => normalizePersistedOptionUnderlying("   ")).toThrow("underlying");
    expect(() => normalizePersistedOptionExpiryDate("2026-02-29")).toThrow("YYYY-MM-DD");
  });

  it("keeps call and put contracts separate while retaining unavailable observations", () => {
    const response = createLatestOptionChainResponse({
      underlying: " nifty ",
      expiryDate: "2026-08-28",
      contracts: [putWithQuote, callWithoutQuote],
    });

    expect(response.contracts.map((contract) => contract.optionType)).toEqual(["CE", "PE"]);
    expect(response.contracts[0]?.quote).toBeNull();
    expect(response.contracts[1]?.greeks).toBeNull();
    expect(response.contracts[1]?.quote?.ltp).toBeNull();
    expect(response.contracts[1]?.quote?.openInterest).toBe(0);
  });

  it("counts coverage and preserves independent quote and Greek freshness", () => {
    const response = createLatestOptionChainResponse({
      underlying: "NIFTY",
      expiryDate: "2026-08-28",
      contracts: [callWithoutQuote, putWithQuote],
    });

    expect(response.coverage).toEqual({ contracts: 2, quotes: 1, greeks: 1 });
    expect(response.freshness).toEqual({
      oldestQuoteAt: "2026-08-31T09:30:01.000Z",
      newestQuoteAt: "2026-08-31T09:30:01.000Z",
      oldestGreekObservedAt: "2026-08-31T09:30:05.000Z",
      newestGreekObservedAt: "2026-08-31T09:30:05.000Z",
    });
    expect(response.contracts[0]?.greeks).not.toHaveProperty("rho");
  });

  it("sorts persisted expiries by date without manufacturing quote freshness", () => {
    expect(sortPersistedOptionExpiries([
      { expiryDate: "2026-09-04", contractCount: 80, latestQuoteAt: null },
      { expiryDate: "2026-08-28", contractCount: 82, latestQuoteAt: "2026-08-27T09:30:00.000Z" },
    ])).toEqual([
      { expiryDate: "2026-08-28", contractCount: 82, latestQuoteAt: "2026-08-27T09:30:00.000Z" },
      { expiryDate: "2026-09-04", contractCount: 80, latestQuoteAt: null },
    ]);
  });
});
