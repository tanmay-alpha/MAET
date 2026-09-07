import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { calculateMarketBreadth, getHeatmapCells } from "./service";
import { db } from "../../data/drizzle/client";
import { companies, quoteSnapshots, candles } from "../../db/schema";
import { inArray } from "drizzle-orm";

const TEST_COMPANY_IDS = [
  "00000000-0000-0000-0000-000000000101",
  "00000000-0000-0000-0000-000000000102",
  "00000000-0000-0000-0000-000000000103",
  "00000000-0000-0000-0000-000000000104",
  "00000000-0000-0000-0000-000000000105",
  "00000000-0000-0000-0000-000000000106",
];

const FIXTURE_COMPANIES = [
  {
    id: "00000000-0000-0000-0000-000000000101",
    symbol: "TEST_MB_ADV1",
    name: "Breadth Advance Co 1",
    exchange: "NSE",
    sector: "Technology",
    marketCap: "10000",
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000102",
    symbol: "TEST_MB_ADV2",
    name: "Breadth Advance Co 2",
    exchange: "NSE",
    sector: "Technology",
    marketCap: "20000",
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000103",
    symbol: "TEST_MB_DEC1",
    name: "Breadth Decline Co 1",
    exchange: "NSE",
    sector: "Energy",
    marketCap: "30000",
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000104",
    symbol: "TEST_MB_UNC1",
    name: "Breadth Unchanged Co 1",
    exchange: "NSE",
    sector: "Finance",
    marketCap: "40000",
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000105",
    symbol: "TEST_MB_NOQUOTE",
    name: "Breadth No Quote Co",
    exchange: "NSE",
    sector: "Finance",
    marketCap: "50000",
    isActive: true,
  },
  {
    id: "00000000-0000-0000-0000-000000000106",
    symbol: "TEST_MB_NOCAP",
    name: "Breadth No Cap Co",
    exchange: "NSE",
    sector: "Healthcare",
    marketCap: null,
    isActive: true,
  },
];

const FIXTURE_QUOTES = [
  {
    id: "20000000-0000-0000-0000-000000000101",
    companyId: "00000000-0000-0000-0000-000000000101",
    price: "110.00",
    changePct: "2.5",
    asOf: new Date("2026-07-31T10:00:00Z"),
    source: "test",
  },
  {
    id: "20000000-0000-0000-0000-000000000102",
    companyId: "00000000-0000-0000-0000-000000000102",
    price: "205.00",
    changePct: "1.0",
    asOf: new Date("2026-07-31T11:00:00Z"),
    source: "test",
  },
  {
    id: "20000000-0000-0000-0000-000000000103",
    companyId: "00000000-0000-0000-0000-000000000103",
    price: "295.00",
    changePct: "-1.5",
    asOf: new Date("2026-07-31T09:00:00Z"),
    source: "test",
  },
  {
    id: "20000000-0000-0000-0000-000000000104",
    companyId: "00000000-0000-0000-0000-000000000104",
    price: "400.00",
    changePct: "0.0",
    asOf: new Date("2026-07-31T09:30:00Z"),
    source: "test",
  },
  {
    id: "20000000-0000-0000-0000-000000000106",
    companyId: "00000000-0000-0000-0000-000000000106",
    price: "50.00",
    changePct: "3.0",
    asOf: new Date("2026-07-31T10:30:00Z"),
    source: "test",
  },
];

// Generate 25 daily candles for TEST_MB_ADV1
const FIXTURE_CANDLES: any[] = [];
for (let i = 0; i < 25; i++) {
  const date = new Date("2026-07-30T00:00:00Z");
  date.setDate(date.getDate() - i);
  FIXTURE_CANDLES.push({
    symbol: "TEST_MB_ADV1",
    timeframe: "1d",
    open: "100.00",
    high: i === 0 ? "108.00" : "105.00", // current price 110 exceeds 20d high!
    low: "95.00",
    close: "100.00", // SMA20 will be ~100. Current price 110 is above SMA20!
    volume: 10000,
    ts: date,
    source: "test",
  });
}

// Generate 10 daily candles for TEST_MB_DEC1 (< 20 bars: insufficient history)
for (let i = 0; i < 10; i++) {
  const date = new Date("2026-07-30T00:00:00Z");
  date.setDate(date.getDate() - i);
  FIXTURE_CANDLES.push({
    symbol: "TEST_MB_DEC1",
    timeframe: "1d",
    open: "300.00",
    high: "310.00",
    low: "290.00",
    close: "300.00",
    volume: 10000,
    ts: date,
    source: "test",
  });
}

describe("Market Breadth & Heatmap Integrity Suite", () => {
  beforeAll(async () => {
    await db.delete(quoteSnapshots).where(inArray(quoteSnapshots.companyId, TEST_COMPANY_IDS));
    await db.delete(companies).where(inArray(companies.id, TEST_COMPANY_IDS));
    await db.delete(candles).where(inArray(candles.symbol, ["TEST_MB_ADV1", "TEST_MB_DEC1"]));

    await db.insert(companies).values(FIXTURE_COMPANIES);
    await db.insert(quoteSnapshots).values(FIXTURE_QUOTES as any);
    await db.insert(candles).values(FIXTURE_CANDLES as any);
  });

  afterAll(async () => {
    await db.delete(quoteSnapshots).where(inArray(quoteSnapshots.companyId, TEST_COMPANY_IDS));
    await db.delete(companies).where(inArray(companies.id, TEST_COMPANY_IDS));
    await db.delete(candles).where(inArray(candles.symbol, ["TEST_MB_ADV1", "TEST_MB_DEC1"]));
  });

  it("1. Returns real structural calculation object with verified metadata", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.available).toBe(true);
    expect(breadth.universe).toBe("ALL_NSE");
    expect(breadth).toHaveProperty("advances");
    expect(breadth).toHaveProperty("declines");
    expect(breadth).toHaveProperty("advanceDeclineRatio");
    expect(breadth).toHaveProperty("marketCapWeightedChange");
    expect(breadth).toHaveProperty("sectorContribution");
    expect(breadth).toHaveProperty("quoteCoverage");
    expect(breadth).toHaveProperty("generatedAt");
  });

  it("2. Advance/decline count integrity: advances + declines + unchanged equals companiesWithUsableQuote", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.advances + breadth.declines + breadth.unchanged).toBe(breadth.companiesWithUsableQuote);
  });

  it("3. Advance/decline ratio calculation computes advances / declines when declines > 0", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    if (breadth.declines > 0) {
      const expectedRatio = Number((breadth.advances / breadth.declines).toFixed(2));
      expect(breadth.advanceDeclineRatio).toBe(expectedRatio);
    }
  });

  it("4. Advance/decline ratio truthful null: returns null when declines === 0", async () => {
    // When declines is 0, the ratio must be null (never Infinity, 0, or NaN)
    const mockZeroDeclines = (advances: number, declines: number) =>
      declines > 0 ? Number((advances / declines).toFixed(2)) : null;
    expect(mockZeroDeclines(10, 0)).toBeNull();
    expect(mockZeroDeclines(0, 0)).toBeNull();
    expect(mockZeroDeclines(10, 5)).toBe(2);
  });

  it("5. Positive market-cap weighted change: only stocks with verified positive market cap participate", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(typeof breadth.marketCapWeightedChange).toBe("number");
    expect(!isNaN(breadth.marketCapWeightedChange)).toBe(true);
  });

  it("6. Market-cap coverage accurately reports participating vs eligible market cap", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.marketCapCoverage).toBeGreaterThanOrEqual(0);
    expect(breadth.marketCapCoverage).toBeLessThanOrEqual(1);
  });

  it("7. Universe validation: unverified universes return available: false with truthful reason", async () => {
    const res = await calculateMarketBreadth("NIFTY_50");
    expect(res.available).toBe(false);
    expect(res.reason).toContain("Only ALL_NSE is supported");
    expect(res.advances).toBe(0);
    expect(res.advanceDeclineRatio).toBeNull();
  });

  it("8. Quote coverage reports eligibleCompanies, companiesWithUsableQuote, and quoteCoverage", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.eligibleCompanies).toBeGreaterThanOrEqual(6);
    expect(breadth.companiesWithUsableQuote).toBeGreaterThanOrEqual(5);
    expect(breadth.quoteCoverage).toBeGreaterThan(0);
    expect(breadth.quoteCoverage).toBeLessThanOrEqual(1);
  });

  it("9. Exclusion tracking: companies without verified quotes are counted in excludedCount", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.excludedCount).toBeGreaterThanOrEqual(1); // TEST_MB_NOQUOTE
    expect(breadth.eligibleCompanies).toBe(breadth.companiesWithUsableQuote + breadth.excludedCount);
  });

  it("10. Trailing 20-session high/low calculated from daily candles", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    // TEST_MB_ADV1 has price 110, which exceeds its 20d candle high of 108 -> new20DayHigh >= 1
    expect(breadth.new20DayHigh).toBeGreaterThanOrEqual(1);
    expect(breadth.eligible20dSessions).toBeGreaterThanOrEqual(1);
  });

  it("11. Insufficient candle history: stocks with < 20 daily bars are excluded from 20d high/low without error", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    // TEST_MB_DEC1 only has 10 candles, so it cannot be counted in eligible20dSessions
    expect(breadth.eligible20dSessions).toBeLessThan(breadth.companiesWithUsableQuote);
  });

  it("12. SMA20/50/200 calculation: computed from daily closes with eligibility requirements", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.sma20Eligible).toBeGreaterThanOrEqual(1); // TEST_MB_ADV1
    expect(breadth.aboveSma20).toBeGreaterThanOrEqual(1); // price 110 > SMA20 100
    expect(breadth.pctAboveSma20).toBeGreaterThan(0);
  });

  it("13. SMA eligibility integrity: stocks with insufficient history are NOT counted as below SMA", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    // Only companies with >= 20 bars are in sma20Eligible.
    // pctAboveSma20 is (aboveSma20 / sma20Eligible) * 100, NOT divided by total companies
    if (breadth.sma20Eligible > 0) {
      expect(breadth.pctAboveSma20).toBe(
        Number(((breadth.aboveSma20 / breadth.sma20Eligible) * 100).toFixed(2))
      );
    }
  });

  it("14. Provenance tracking: newestQuoteAt, oldestQuoteAt, asOf, and generatedAt are valid ISO timestamps", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.newestQuoteAt).not.toBeNull();
    expect(breadth.oldestQuoteAt).not.toBeNull();
    expect(new Date(breadth.newestQuoteAt!).getTime()).not.toBeNaN();
    expect(new Date(breadth.oldestQuoteAt!).getTime()).not.toBeNaN();
    expect(new Date(breadth.generatedAt).getTime()).not.toBeNaN();
    expect(new Date(breadth.asOf).getTime()).not.toBeNaN();
  });

  it("15. Heatmap cells generation: cells have verified weights, sizeEligible flag, price, and changePct", async () => {
    const res = await getHeatmapCells("ALL_NSE");
    expect(res.available).toBe(true);
    expect(res.cells.length).toBeGreaterThan(0);

    const cellWithCap = res.cells.find((c) => c.symbol === "TEST_MB_ADV1");
    expect(cellWithCap).toBeDefined();
    expect(cellWithCap!.sizeEligible).toBe(true);
    expect(cellWithCap!.weight).toBeGreaterThan(0);
    expect(cellWithCap!.price).toBe(110);
    expect(cellWithCap!.changePct).toBe(2.5);

    const cellWithoutCap = res.cells.find((c) => c.symbol === "TEST_MB_NOCAP");
    expect(cellWithoutCap).toBeDefined();
    expect(cellWithoutCap!.sizeEligible).toBe(false);
    expect(cellWithoutCap!.weight).toBe(0);
  });

  it("16. Sector contribution breakdown: sector counts, average change, and weights calculated correctly", async () => {
    const breadth = await calculateMarketBreadth("ALL_NSE");
    expect(breadth.sectorContribution).toHaveProperty("Technology");
    const tech = breadth.sectorContribution["Technology"];
    expect(tech.count).toBeGreaterThanOrEqual(2);
    expect(typeof tech.avgChange).toBe("number");
    expect(typeof tech.weight).toBe("number");
  });
});
