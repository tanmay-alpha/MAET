import { describe, expect, it } from "bun:test";
import type { OptionChainContractView } from "./contracts";
import {
  createLatestOptionChainResponse,
  normalizePersistedOptionExpiryDate,
  normalizePersistedOptionUnderlying,
  listPersistedOptionExpiries,
  sortPersistedOptionExpiries,
} from "./read-model";
import { getSqlClient } from "../../data/drizzle/client";

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

  it("counts each contract once per expiry however many quote snapshots it has", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping persisted expiry count test: TEST_DATABASE_URL not set");
      return;
    }
    const sql = getSqlClient();
    const underlying = `T${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`.toUpperCase();
    const [call, put] = [crypto.randomUUID(), crypto.randomUUID()];
    try {
      await sql`
        INSERT INTO public.option_contracts (id, provider, exchange, token, trading_symbol, underlying, expiry_date, strike_price, option_type, lot_size, instrument_type, is_active)
        VALUES (${call}, 'angelone', 'NFO', ${`${underlying}-1`}, ${`${underlying}CE`}, ${underlying}, '2026-08-28', 24500, 'CE', 75, 'OPTIDX', true),
               (${put}, 'angelone', 'NFO', ${`${underlying}-2`}, ${`${underlying}PE`}, ${underlying}, '2026-08-28', 24500, 'PE', 75, 'OPTIDX', true)
      `;
      await sql`
        INSERT INTO public.option_quote_snapshots (contract_id, ltp, exchange_feed_at, source)
        VALUES (${call}, 100, '2026-08-27T09:15:00Z', 'test'),
               (${call}, 101, '2026-08-27T09:16:00Z', 'test'),
               (${call}, 102, '2026-08-27T09:17:00Z', 'test'),
               (${put}, 90, '2026-08-27T09:15:00Z', 'test')
      `;
      expect(await listPersistedOptionExpiries({ underlying })).toEqual([
        { expiryDate: "2026-08-28", contractCount: 2, latestQuoteAt: "2026-08-27T09:17:00.000Z" },
      ]);
    } finally {
      // Snapshots are append-only; skip the trigger for this cleanup transaction only.
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`DELETE FROM public.option_quote_snapshots WHERE contract_id IN (${call}, ${put})`;
        await tx`DELETE FROM public.option_contracts WHERE id IN (${call}, ${put})`;
      });
    }
  });
});
