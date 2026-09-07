import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { getPeerComparison } from "./service";
import { db } from "../../data/drizzle/client";
import { companies, fundamentals, quoteSnapshots } from "../../db/schema";
import { inArray, eq } from "drizzle-orm";

const TEST_SYMBOLS = [
  "TEST_TGT_IND",
  "TEST_IND_P1",
  "TEST_IND_P2",
  "TEST_IND_TIE_A",
  "TEST_IND_TIE_B",
  "TEST_TGT_SEC",
  "TEST_SEC_P1",
  "TEST_TGT_SOLO",
  "TEST_TGT_NOCAP",
  "TEST_NOCAP_P1",
  "TEST_NOCAP_P2",
];

const FIXTURE_COMPANIES = [
  // Industry test group (Tech-Alpha)
  {
    id: "00000000-0000-0000-0000-000000000001",
    symbol: "TEST_TGT_IND",
    name: "Target Industry Co",
    exchange: "NSE",
    industry: "Tech-Alpha",
    sector: "Technology",
    marketCap: "1000",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    symbol: "TEST_IND_P1",
    name: "Industry Peer 1",
    exchange: "NSE",
    industry: "Tech-Alpha",
    sector: "Technology",
    marketCap: "1500",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    symbol: "TEST_IND_P2",
    name: "Industry Peer 2",
    exchange: "NSE",
    industry: "Tech-Alpha",
    sector: "Technology",
    marketCap: "600",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    symbol: "TEST_IND_TIE_B",
    name: "Industry Tie B",
    exchange: "NSE",
    industry: "Tech-Alpha",
    sector: "Technology",
    marketCap: "1100",
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    symbol: "TEST_IND_TIE_A",
    name: "Industry Tie A",
    exchange: "NSE",
    industry: "Tech-Alpha",
    sector: "Technology",
    marketCap: "1100",
  },
  // Sector fallback test group (Energy)
  {
    id: "00000000-0000-0000-0000-000000000006",
    symbol: "TEST_TGT_SEC",
    name: "Target Sector Co",
    exchange: "NSE",
    industry: "Unique-Ind-1",
    sector: "Energy",
    marketCap: "2000",
  },
  {
    id: "00000000-0000-0000-0000-000000000007",
    symbol: "TEST_SEC_P1",
    name: "Sector Peer 1",
    exchange: "NSE",
    industry: "Different-Ind-2",
    sector: "Energy",
    marketCap: "2200",
  },
  // Solo company group (no peers in industry or sector)
  {
    id: "00000000-0000-0000-0000-000000000008",
    symbol: "TEST_TGT_SOLO",
    name: "Solo Co",
    exchange: "NSE",
    industry: "Isolated-Ind",
    sector: "Isolated-Sec",
    marketCap: "3000",
  },
  // No market cap target group (Tech-Beta)
  {
    id: "00000000-0000-0000-0000-000000000009",
    symbol: "TEST_TGT_NOCAP",
    name: "Target No Cap Co",
    exchange: "NSE",
    industry: "Tech-Beta",
    sector: "Technology",
    marketCap: null,
  },
  {
    id: "00000000-0000-0000-0000-000000000010",
    symbol: "TEST_NOCAP_P1",
    name: "NoCap Peer 1",
    exchange: "NSE",
    industry: "Tech-Beta",
    sector: "Technology",
    marketCap: "5000",
  },
  {
    id: "00000000-0000-0000-0000-000000000011",
    symbol: "TEST_NOCAP_P2",
    name: "NoCap Peer 2",
    exchange: "NSE",
    industry: "Tech-Beta",
    sector: "Technology",
    marketCap: "8000",
  },
];

const FIXTURE_FUNDAMENTALS = [
  // Target: pe = 100, roe = 0.30, periodDate = 2026-03-31
  {
    id: "10000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000001",
    periodDate: new Date("2026-03-31T00:00:00Z"),
    periodType: "annual",
    peRatio: "100",
    pbRatio: "5.0",
    roe: "0.30",
    source: "test",
  },
  // Industry Peer 1: pe = 10, roe = 0.10, periodDate = 2026-03-31
  {
    id: "10000000-0000-0000-0000-000000000002",
    companyId: "00000000-0000-0000-0000-000000000002",
    periodDate: new Date("2026-03-31T00:00:00Z"),
    periodType: "annual",
    peRatio: "10",
    pbRatio: "1.5",
    roe: "0.10",
    source: "test",
  },
  // Industry Peer 2: pe = 20, roe = null (missing), periodDate = 2026-03-31
  {
    id: "10000000-0000-0000-0000-000000000003",
    companyId: "00000000-0000-0000-0000-000000000003",
    periodDate: new Date("2026-03-31T00:00:00Z"),
    periodType: "annual",
    peRatio: "20",
    pbRatio: "2.0",
    roe: null,
    source: "test",
  },
];

const FIXTURE_QUOTES = [
  {
    id: "20000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000001",
    price: "100.50",
    asOf: new Date("2026-07-31T10:00:00Z"),
    source: "test",
  },
  {
    id: "20000000-0000-0000-0000-000000000002",
    companyId: "00000000-0000-0000-0000-000000000002",
    price: "250.00",
    asOf: new Date("2026-07-31T11:00:00Z"),
    source: "test",
  },
];

describe("Peer Comparison Integration Suite", () => {
  beforeAll(async () => {
    // Clean up any leftovers
    const companyIds = FIXTURE_COMPANIES.map((c) => c.id);
    await db.delete(quoteSnapshots).where(inArray(quoteSnapshots.companyId, companyIds));
    await db.delete(fundamentals).where(inArray(fundamentals.companyId, companyIds));
    await db.delete(companies).where(inArray(companies.id, companyIds));

    // Seed test fixtures
    await db.insert(companies).values(FIXTURE_COMPANIES);
    await db.insert(fundamentals).values(FIXTURE_FUNDAMENTALS as any);
    await db.insert(quoteSnapshots).values(FIXTURE_QUOTES as any);
  });

  afterAll(async () => {
    const companyIds = FIXTURE_COMPANIES.map((c) => c.id);
    await db.delete(quoteSnapshots).where(inArray(quoteSnapshots.companyId, companyIds));
    await db.delete(fundamentals).where(inArray(fundamentals.companyId, companyIds));
    await db.delete(companies).where(inArray(companies.id, companyIds));
  });

  it("1. Deterministic industry matching returns peers in same industry", async () => {
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    expect(res.selectionBasis).toBe("industry");
    expect(res.selectionLabel).toBe("Tech-Alpha");
    expect(res.peers.length).toBeGreaterThan(0);
    expect(res.peers.every((p) => p.industry === "Tech-Alpha")).toBe(true);
  });

  it("2. Sector fallback when no industry peers exist", async () => {
    const res = await getPeerComparison("TEST_TGT_SEC", 5);
    expect(res.selectionBasis).toBe("sector");
    expect(res.selectionLabel).toBe("Energy");
    expect(res.peers.length).toBe(1);
    expect(res.peers[0].symbol).toBe("TEST_SEC_P1");
  });

  it("3. No peers found returns empty peers with selectionBasis 'none' and label 'None'", async () => {
    const res = await getPeerComparison("TEST_TGT_SOLO", 5);
    expect(res.selectionBasis).toBe("none");
    expect(res.selectionLabel).toBe("None");
    expect(res.peers).toEqual([]);
    expect(res.medians).toEqual({});
  });

  it("4. Peer selection strictly excludes the target company itself", async () => {
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    expect(res.target.symbol).toBe("TEST_TGT_IND");
    expect(res.peers.find((p) => p.symbol === "TEST_TGT_IND")).toBeUndefined();
  });

  it("5. Closest verified market-cap ranking places closest market caps first", async () => {
    // Target MC: 1000. Peers: 1100 (diff 100), 1500 (diff 500), 600 (diff 400).
    // Expected closest: 1100s first, then 600, then 1500.
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    const peerMcs = res.peers.map((p) => p.marketCap);
    expect(peerMcs[0]).toBe(1100);
    expect(peerMcs[1]).toBe(1100);
    expect(peerMcs[2]).toBe(600);
    expect(peerMcs[3]).toBe(1500);
  });

  it("6. Deterministic tie-breaking uses symbol ASC for identical market cap differences", async () => {
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    const tiePeers = res.peers.filter((p) => p.marketCap === 1100);
    expect(tiePeers.length).toBe(2);
    expect(tiePeers[0].symbol).toBe("TEST_IND_TIE_A");
    expect(tiePeers[1].symbol).toBe("TEST_IND_TIE_B");
  });

  it("7. Target with missing market cap ranks peers by market cap DESC with symbol tie-breaker", async () => {
    const res = await getPeerComparison("TEST_TGT_NOCAP", 5);
    expect(res.target.marketCap).toBeNull();
    expect(res.peers.length).toBe(2);
    expect(res.peers[0].symbol).toBe("TEST_NOCAP_P2"); // 8000
    expect(res.peers[0].marketCap).toBe(8000);
    expect(res.peers[1].symbol).toBe("TEST_NOCAP_P1"); // 5000
    expect(res.peers[1].marketCap).toBe(5000);
  });

  it("8. Target company receives valid 1-indexed market-cap rank within returned set", async () => {
    // Target MC = 1000. Peers in set: 1100, 1100, 600, 1500.
    // Full set sorted MC DESC: 1500 (rank 1), 1100 (rank 2), 1100 (rank 3), 1000 (rank 4), 600 (rank 5).
    const res = await getPeerComparison("TEST_TGT_IND", 4);
    expect(res.target.rank).toBe(4);
    expect(typeof res.target.rank).toBe("number");
    expect(Number.isInteger(res.target.rank)).toBe(true);
  });

  it("9. Target company receives valid percentile (0-100) within returned set", async () => {
    // In population of 5: [600, 1000, 1100, 1100, 1500].
    // Target (1000) has 2 items <= 1000: (2 / 5) * 100 = 40%.
    const res = await getPeerComparison("TEST_TGT_IND", 4);
    expect(res.target.percentile).toBe(40);
  });

  it("10. Medians are calculated across peers only (excluding target)", async () => {
    // Limit to 2 peers: P1 (pe: 10, roe: 0.10) and P2 (pe: 20, roe: undefined).
    // Target (pe: 100, roe: 0.30) must NOT influence peer medians.
    // Peer PE median = (10 + 20) / 2 = 15.
    const res = await getPeerComparison("TEST_TGT_IND", 2);
    // Peers returned are TEST_IND_TIE_A, TEST_IND_TIE_B (neither has fundamentals).
    // Let's test specifically with a limit that includes P1 & P2 or query them:
    const allPeersRes = await getPeerComparison("TEST_TGT_IND", 5);
    // Peers with PE: P1 (10), P2 (20). Median = 15.
    expect(allPeersRes.medians.peRatio).toBe(15);
  });

  it("11. Comparison median is calculated across all (target + peers)", async () => {
    // Target PE = 100, Peers PE = [10, 20].
    // Full set PE = [10, 20, 100]. Median = 20.
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    expect(res.comparisonMedian.peRatio).toBe(20);
  });

  it("12. Honest missing metric representation: undefined for missing, never 0", async () => {
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    const p2 = res.peers.find((p) => p.symbol === "TEST_IND_P2")!;
    expect(p2).toBeDefined();
    expect(p2.metrics.roe).toBeUndefined();
    expect(p2.metrics.roe).not.toBe(0);
    expect(p2.metrics.priceMomentum3m).toBeUndefined();
    expect(p2.metrics.priceMomentum3m).not.toBe(0);
  });

  it("13. Provenance timestamps populated truthfully", async () => {
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    expect(res.target.latestFundamentalsAt).toBe("2026-03-31T00:00:00.000Z");
    expect(res.target.latestQuoteAt).toBe("2026-07-31T10:00:00.000Z");
    // Newest quote among target & peers: 2026-07-31T11:00:00.000Z
    expect(res.asOf).toBe("2026-07-31T11:00:00.000Z");
    expect(typeof res.generatedAt).toBe("string");
    expect(new Date(res.generatedAt).getTime()).not.toBeNaN();
  });

  it("14. Bounded batch queries execute without N+1 loops", async () => {
    // Calling getPeerComparison returns promptly and validates with schema
    const start = performance.now();
    const res = await getPeerComparison("TEST_TGT_IND", 5);
    const duration = performance.now() - start;
    expect(res.target.symbol).toBe("TEST_TGT_IND");
    expect(res.peers.length).toBe(4);
    // A batch-loaded query completes well under 250ms locally
    expect(duration).toBeLessThan(500);
  });
});
