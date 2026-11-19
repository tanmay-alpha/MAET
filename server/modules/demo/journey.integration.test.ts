import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { getSqlClient } from "../../data/drizzle/client";
import { loadQuotes, buildQuotesPayload } from "../../domain/market/quote-service";
import { parseCompanyScreenerParams, queryCompanyScreener } from "../../domain/screener/company-query";
import { applyMigrations } from "../../scripts/apply-migrations";
import { DailyProcessor } from "../../workers/daily-processor";
import { seedDemo } from "./seed";
import { DEMO_COMPANIES } from "./universe";

const originalFetch = globalThis.fetch;
const originalDemoMode = process.env.MAET_DEMO_MODE;
const sql = getSqlClient();

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDemoMode === undefined) delete process.env.MAET_DEMO_MODE;
  else process.env.MAET_DEMO_MODE = originalDemoMode;
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("local product journey (PostgreSQL)", () => {
  beforeAll(async () => {
    await applyMigrations();
    // The shared test database holds other suites' users and companies (see seed.integration.test.ts).
    await seedDemo({ allowExistingData: true });
  }, 60_000);

  it("includes stored prices and their provenance in an unfiltered screener page", async () => {
    const result = await queryCompanyScreener(parseCompanyScreenerParams(new URLSearchParams({ search: "DEMO-" })));
    expect(result.items).toHaveLength(DEMO_COMPANIES.length);
    for (const company of result.items) {
      expect(company.price).toBeGreaterThan(0);
      expect(company.volume).toBeGreaterThan(0);
      expect(company.quoteSource).toBe("simulated");
      expect(company.quoteAsOf).toBe("2026-11-18T10:00:00.000Z");
    }
  });

  it("serves seeded quotes as historical synthetic observations without calling market providers", async () => {
    process.env.MAET_DEMO_MODE = "1";
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("Demo symbols must not be sent to a market provider");
    }) as typeof fetch;
    const result = await loadQuotes(DEMO_COMPANIES.map((company) => company.symbol));
    expect(result.errors).toEqual([]);
    expect(result.quotes).toHaveLength(DEMO_COMPANIES.length);
    expect(calls).toEqual([]);
    for (const quote of result.quotes) {
      expect(quote).toMatchObject({ source: "simulated", quality: "synthetic", delayed: true, ts: "2026-11-18T10:00:00.000Z" });
      expect(quote.price).toBeGreaterThan(0);
    }
    expect(buildQuotesPayload(result)).toMatchObject({ source: "simulated", delayed: true });
  });

  it("does not serve demo snapshots when demo mode is disabled", async () => {
    delete process.env.MAET_DEMO_MODE;
    globalThis.fetch = (async () => { throw new Error("Provider unavailable"); }) as typeof fetch;
    const result = await loadQuotes(["DEMO-ARKA"], true);
    expect(result.quotes).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("cleans up old candles using a Postgres-serializable retention cutoff", async () => {
    const symbol = "JOURNEY-CLEANUP";
    await sql`DELETE FROM candles WHERE symbol = ${symbol}`;
    try {
      await sql`INSERT INTO candles (symbol, timeframe, ts, open, high, low, close, volume, source)
        VALUES (${symbol}, '1d', '2000-01-03T03:45:00Z'::timestamptz, 100, 101, 99, 100, 10, 'test'),
               (${symbol}, '1d', now(), 100, 101, 99, 100, 10, 'test')`;
      await new DailyProcessor({
        symbols: [], syncCompanyMaster: false, syncMarketData: false,
        syncFundamentals: false, refreshClassifications: false,
      }).run();
      const remaining = await sql`SELECT ts FROM candles WHERE symbol = ${symbol}`;
      expect(remaining).toHaveLength(1);
      expect(new Date(remaining[0].ts).getUTCFullYear()).toBeGreaterThan(2000);
    } finally {
      await sql`DELETE FROM candles WHERE symbol = ${symbol}`;
    }
  });
});
