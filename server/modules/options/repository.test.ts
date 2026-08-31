import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getOptionContractConflictUpdateValues,
  getOptionContractInsertValues,
  getOptionGreekKey,
  indexOptionContractsByGreekKey,
  normalizeAngelOneOptionExpiry,
  prepareOptionGreekSnapshots,
  prepareOptionQuoteSnapshots,
} from "./repository";

const seenAt = new Date("2026-08-31T09:00:00.000Z");

describe("options repository domain mapping", () => {
  it("normalizes a strict Angel One expiry to the canonical database date", () => {
    expect(normalizeAngelOneOptionExpiry(" 28aug2026 ")).toBe("2026-08-28");
    expect(normalizeAngelOneOptionExpiry("29FEB2028")).toBe("2028-02-29");
  });

  it("rejects malformed and impossible Angel One expiries", () => {
    for (const expiry of ["2026-08-28", "28AUG26", "31APR2026", "29FEB2027", "00AUG2026", "01JAN0000"]) {
      expect(() => normalizeAngelOneOptionExpiry(expiry)).toThrow("valid DDMMMYYYY expiry");
    }
  });

  it("maps provider contracts to canonical active Angel One NFO rows", () => {
    expect(getOptionContractInsertValues({
      underlying: "NIFTY",
      expiryDate: "2026-08-28",
      contracts: [{
        token: "17500CE",
        tradingSymbol: "NIFTY28AUG2617500CE",
        name: "NIFTY",
        expiry: "28AUG2026",
        strikePrice: 17_500,
        optionType: "CE",
        lotSize: 75,
        instrumentType: "OPTIDX",
      }],
    }, seenAt)).toEqual([{
      provider: "angelone",
      exchange: "NFO",
      token: "17500CE",
      tradingSymbol: "NIFTY28AUG2617500CE",
      underlying: "NIFTY",
      expiryDate: "2026-08-28",
      strikePrice: "17500.0000",
      optionType: "CE",
      lotSize: 75,
      instrumentType: "OPTIDX",
      isActive: true,
      lastSeenAt: seenAt,
    }]);
  });

  it("updates only mutable contract metadata and preserves firstSeenAt", () => {
    expect(Object.keys(getOptionContractConflictUpdateValues()).sort()).toEqual([
      "expiryDate",
      "instrumentType",
      "isActive",
      "lastSeenAt",
      "lotSize",
      "optionType",
      "strikePrice",
      "token",
      "underlying",
    ]);
    expect(getOptionContractConflictUpdateValues()).not.toHaveProperty("firstSeenAt");
  });

  it("maps verified quote fields without turning unavailable values into zero", () => {
    const prepared = prepareOptionQuoteSnapshots([{
      contractId: "11111111-1111-4111-8111-111111111111",
      quote: {
        exchange: "NFO",
        token: "17500CE",
        tradingSymbol: "NIFTY28AUG2617500CE",
        ltp: 0,
        volume: 0,
        openInterest: 12_345,
        netChange: -1.25,
        bestBidPrice: 0,
        bestBidQuantity: 0,
        exchangeFeedAt: "2026-08-31T05:00:00.000Z",
      },
    }]);

    expect(prepared.unusableContractIds).toEqual([]);
    expect(prepared.rows).toEqual([{
      contractId: "11111111-1111-4111-8111-111111111111",
      ltp: "0",
      open: null,
      high: null,
      low: null,
      close: null,
      volume: 0,
      openInterest: 12_345,
      netChange: "-1.25",
      percentChange: null,
      averagePrice: null,
      totalBuyQuantity: null,
      totalSellQuantity: null,
      bestBidPrice: "0",
      bestBidQuantity: 0,
      bestAskPrice: null,
      bestAskQuantity: null,
      exchangeFeedAt: new Date("2026-08-31T05:00:00.000Z"),
      exchangeTradeAt: null,
      source: "angelone",
    }]);
  });

  it("rejects quote observations without any provider market field", () => {
    const prepared = prepareOptionQuoteSnapshots([{
      contractId: "22222222-2222-4222-8222-222222222222",
      quote: {
        exchange: "NFO",
        token: "17500PE",
        tradingSymbol: "NIFTY28AUG2617500PE",
        exchangeFeedAt: "2026-08-31T05:00:00.000Z",
      },
    }]);

    expect(prepared.rows).toEqual([]);
    expect(prepared.unusableContractIds).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });

  it("maps usable Greeks with one local observation time and no provider timestamp", () => {
    const observedAt = new Date("2026-08-31T05:00:01.000Z");
    const prepared = prepareOptionGreekSnapshots([{
      contractId: "33333333-3333-4333-8333-333333333333",
      greek: {
        name: "NIFTY",
        expiry: "28AUG2026",
        strikePrice: 17_500,
        optionType: "PE",
        delta: -0.4,
        impliedVolatility: 0,
        tradeVolume: 0,
      },
    }], observedAt);

    expect(prepared.unusableContractIds).toEqual([]);
    expect(prepared.rows).toEqual([{
      contractId: "33333333-3333-4333-8333-333333333333",
      delta: "-0.4",
      gamma: null,
      theta: null,
      vega: null,
      impliedVolatility: "0",
      tradeVolume: 0,
      observedAt,
      source: "angelone",
    }]);
    expect(prepared.rows[0]).not.toHaveProperty("rho");
    expect(prepared.rows[0]).not.toHaveProperty("exchangeFeedAt");
  });

  it("rejects all-null Greek observations", () => {
    const prepared = prepareOptionGreekSnapshots([{
      contractId: "44444444-4444-4444-8444-444444444444",
      greek: {
        name: "NIFTY",
        expiry: "28AUG2026",
        strikePrice: 17_500,
        optionType: "CE",
      },
    }], seenAt);

    expect(prepared.rows).toEqual([]);
    expect(prepared.unusableContractIds).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });

  it("builds deterministic strike and option-side keys at database precision", () => {
    expect(getOptionGreekKey(24_500, "CE")).toBe("24500.0000:CE");
    expect(getOptionGreekKey("24500.0000", "PE")).toBe("24500.0000:PE");
    expect(getOptionGreekKey("9999999999999.9999", "CE")).toBe("9999999999999.9999:CE");
  });

  it("rejects duplicate canonical contracts for one Greek key", () => {
    expect(() => indexOptionContractsByGreekKey([
      { id: "contract-a", token: "101", tradingSymbol: "NIFTY-A", strikePrice: "24500.0000", optionType: "CE", instrumentType: "OPTIDX" },
      { id: "contract-b", token: "102", tradingSymbol: "NIFTY-B", strikePrice: "24500.0000", optionType: "CE", instrumentType: "OPTIDX" },
    ])).toThrow("duplicate canonical option contract for 24500.0000:CE");
  });

  it("uses append-only quote conflict handling and the canonical contract identity", () => {
    const repositorySource = readFileSync(join(import.meta.dir, "repository.ts"), "utf8");
    expect(repositorySource).toContain("optionContracts.provider, optionContracts.exchange, optionContracts.tradingSymbol");
    expect(repositorySource).toContain("onConflictDoNothing");
    expect(repositorySource).toContain("optionQuoteSnapshots.contractId, optionQuoteSnapshots.exchangeFeedAt");
    expect(repositorySource).not.toMatch(/option_chain(?!_)/u);
  });
});
