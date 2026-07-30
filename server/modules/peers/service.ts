/**
 * Peer comparison service.
 *
 * Selects up to 10 peers by industry, then sector, then closest verified
 * market cap. Returns deterministic percentile ranks and medians.
 */

import { db } from "../../data/drizzle/client";
import { companies, fundamentals, quoteSnapshots } from "../../db/schema";
import { and, eq, ne, sql, isNotNull, desc } from "drizzle-orm";
import type { PeerComparisonEntry, PeerComparisonResult, PeerMetric } from "./contracts";

interface RawCompany {
  id: string;
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
}

export async function getPeerComparison(
  symbol: string,
  limit: number
): Promise<PeerComparisonResult> {
  const target = await lookupCompany(symbol);
  if (!target) {
    throw new Error(`Company not found: ${symbol}`);
  }

  const peers = await selectPeers(target, limit);
  const all = [...peers, target];

  const enriched = await Promise.all(all.map((c) => enrichWithMetrics(c, c.symbol === target.symbol)));
  const targetEntry = enriched[enriched.length - 1];
  const peerEntries = enriched.slice(0, -1);

  const medians = computeMedians(peerEntries);
  const sectorMedian = computeMedians(enriched);

  const ranked = rankPeers(peerEntries, target, peerEntries.concat([targetEntry]));

  return {
    target: targetEntry,
    peers: ranked,
    medians,
    sectorMedian,
    asOf: new Date().toISOString(),
  };
}

async function lookupCompany(symbol: string): Promise<RawCompany | null> {
  const rows = await db
    .select({
      id: companies.id,
      symbol: companies.symbol,
      name: companies.name,
      sector: companies.sector,
      industry: companies.industry,
      marketCap: companies.marketCap,
    })
    .from(companies)
    .where(eq(companies.symbol, symbol.toUpperCase()))
    .limit(1);

  return rows[0] ?? null;
}

async function selectPeers(target: RawCompany, limit: number): Promise<RawCompany[]> {
  // First pass: same industry, has identity data, has market cap
  if (target.industry) {
    const sameIndustry = await db
      .select({
        id: companies.id,
        symbol: companies.symbol,
        name: companies.name,
        sector: companies.sector,
        industry: companies.industry,
        marketCap: companies.marketCap,
      })
      .from(companies)
      .where(
        and(
          eq(companies.industry, target.industry),
          ne(companies.symbol, target.symbol),
          isNotNull(companies.marketCap),
        )
      )
      .limit(50);

    if (sameIndustry.length >= limit) {
      return rankByMarketCap(sameIndustry, target, limit);
    }
  }

  // Fallback: same sector
  if (target.sector) {
    const sameSector = await db
      .select({
        id: companies.id,
        symbol: companies.symbol,
        name: companies.name,
        sector: companies.sector,
        industry: companies.industry,
        marketCap: companies.marketCap,
      })
      .from(companies)
      .where(
        and(
          eq(companies.sector, target.sector),
          ne(companies.symbol, target.symbol),
          isNotNull(companies.marketCap),
        )
      )
      .limit(50);

    if (sameSector.length >= limit) {
      return rankByMarketCap(sameSector, target, limit);
    }

    // Combine what we have
    const combined = target.industry
      ? Array.from(new Map([...sameSector].map((c) => [c.id, c])).values())
      : sameSector;
    return rankByMarketCap(combined, target, limit);
  }

  return [];
}

function rankByMarketCap(candidates: RawCompany[], target: RawCompany, limit: number): RawCompany[] {
  const targetMc = target.marketCap ? Number(target.marketCap) : 0;
  return candidates
    .map((c) => ({
      ...c,
      distance: Math.abs((c.marketCap ? Number(c.marketCap) : 0) - targetMc),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      sector: c.sector,
      industry: c.industry,
      marketCap: c.marketCap,
    }));
}

async function enrichWithMetrics(c: RawCompany, isTarget: boolean): Promise<PeerComparisonEntry> {
  const [fund] = await db
    .select()
    .from(fundamentals)
    .where(eq(fundamentals.companyId, c.id))
    .orderBy(desc(fundamentals.periodDate))
    .limit(1);

  const [quote] = await db
    .select()
    .from(quoteSnapshots)
    .where(eq(quoteSnapshots.companyId, c.id))
    .orderBy(desc(quoteSnapshots.asOf))
    .limit(1);

  const metrics: PeerMetric = {
    marketCap: c.marketCap ? Number(c.marketCap) : undefined,
    peRatio: fund?.peRatio ? Number(fund.peRatio) : undefined,
    pbRatio: fund?.pbRatio ? Number(fund.pbRatio) : undefined,
    enterpriseValueToEbitda: fund?.enterpriseValueToEbitda ? Number(fund.enterpriseValueToEbitda) : undefined,
    roe: fund?.roe ? Number(fund.roe) : undefined,
    roce: fund?.roce ? Number(fund.roce) : undefined,
    revenueGrowth: fund?.revenueGrowth ? Number(fund.revenueGrowth) : undefined,
    epsGrowth: fund?.epsGrowth ? Number(fund.epsGrowth) : undefined,
    netMargin: fund?.netMargin ? Number(fund.netMargin) : undefined,
    debtToEquity: fund?.debtToEquity ? Number(fund.debtToEquity) : undefined,
    freeCashFlowYield: fund?.freeCashFlowYield ? Number(fund.freeCashFlowYield) : undefined,
    relativeVolume: fund?.relativeVolume ? Number(fund.relativeVolume) : undefined,
  };

  const dataCoverage = Object.values(metrics).filter((v) => v !== undefined).length / Object.keys(metrics).length;

  return {
    symbol: c.symbol,
    name: c.name,
    sector: c.sector,
    industry: c.industry,
    marketCap: c.marketCap ? Number(c.marketCap) : null,
    isTarget,
    rank: 0,
    percentile: 0,
    metrics,
    dataCoverage,
  };
}

function computeMedians(entries: PeerComparisonEntry[]): PeerMetric {
  const keys: (keyof PeerMetric)[] = [
    "marketCap",
    "peRatio",
    "pbRatio",
    "enterpriseValueToEbitda",
    "roe",
    "roce",
    "revenueGrowth",
    "epsGrowth",
    "netMargin",
    "debtToEquity",
    "freeCashFlowYield",
    "relativeVolume",
  ];
  const out: PeerMetric = {};
  for (const key of keys) {
    const values = entries
      .map((e) => e.metrics[key])
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    if (values.length === 0) continue;
    const mid = Math.floor(values.length / 2);
    out[key] = values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }
  return out;
}

function rankPeers(peerEntries: PeerComparisonEntry[], target: RawCompany, all: PeerComparisonEntry[]): PeerComparisonEntry[] {
  // Rank by market cap closeness
  const targetMc = target.marketCap ? Number(target.marketCap) : 0;
  return peerEntries
    .map((p) => ({
      ...p,
      rank: 0,
      percentile: 0,
    }))
    .map((p) => {
      const peerMc = p.marketCap ?? 0;
      const smaller = all.filter((c) => (c.marketCap ?? 0) <= peerMc).length;
      const percentile = all.length > 0 ? Math.round((smaller / all.length) * 100) : 0;
      return { ...p, percentile };
    })
    .sort((a, b) => {
      const aDist = Math.abs((a.marketCap ?? 0) - targetMc);
      const bDist = Math.abs((b.marketCap ?? 0) - targetMc);
      return aDist - bDist;
    })
    .map((p, i) => ({ ...p, rank: i + 1 }));
}