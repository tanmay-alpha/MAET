/**
 * Peer comparison service.
 *
 * Selects up to 10 peers deterministically by industry, then sector,
 * then closest verified market cap with symbol tie-breakers.
 * Batch-loads fundamentals and quote snapshots in bounded queries.
 */

import { db } from "../../data/drizzle/client";
import { companies, fundamentals, quoteSnapshots } from "../../db/schema";
import { and, eq, ne, isNotNull, desc, inArray } from "drizzle-orm";
import type { PeerComparisonEntry, PeerComparisonResult, PeerMetric } from "./contracts";

interface RawCompany {
  id: string;
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
}

interface PeerSelection {
  peers: RawCompany[];
  selectionBasis: "industry" | "sector" | "none";
  selectionLabel: string;
}

function toIsoOrNull(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toISOString();
  }
  return null;
}

export async function getPeerComparison(
  symbol: string,
  limit: number = 5
): Promise<PeerComparisonResult> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const target = await lookupCompany(normalizedSymbol);
  if (!target) {
    throw new Error(`Company not found: ${normalizedSymbol}`);
  }

  const { peers, selectionBasis, selectionLabel } = await selectPeers(target, limit);
  const all = [target, ...peers];
  const companyIds = all.map((c) => c.id);

  const [fundRows, quoteRows] = await Promise.all([
    companyIds.length > 0
      ? db
          .selectDistinctOn([fundamentals.companyId])
          .from(fundamentals)
          .where(inArray(fundamentals.companyId, companyIds))
          .orderBy(fundamentals.companyId, desc(fundamentals.periodDate))
      : Promise.resolve([]),
    companyIds.length > 0
      ? db
          .selectDistinctOn([quoteSnapshots.companyId])
          .from(quoteSnapshots)
          .where(inArray(quoteSnapshots.companyId, companyIds))
          .orderBy(quoteSnapshots.companyId, desc(quoteSnapshots.asOf))
      : Promise.resolve([]),
  ]);

  const fundMap = new Map<string, (typeof fundRows)[number]>();
  for (const f of fundRows) {
    fundMap.set(f.companyId, f);
  }

  const quoteMap = new Map<string, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    quoteMap.set(q.companyId, q);
  }

  const rawTargetEntry = buildEntry(target, true, fundMap, quoteMap);
  const rawPeerEntries = peers.map((p) => buildEntry(p, false, fundMap, quoteMap));
  const rawAll = [rawTargetEntry, ...rawPeerEntries];

  // Determine 1-based market cap rank among the returned population (target + peers)
  const sortedByMarketCap = [...rawAll].sort((a, b) => {
    const aMc = a.marketCap;
    const bMc = b.marketCap;
    if (aMc != null && bMc != null) {
      if (bMc !== aMc) return bMc - aMc; // Largest market cap first
    } else if (aMc != null) {
      return -1;
    } else if (bMc != null) {
      return 1;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const totalCompanies = rawAll.length;

  const assignRankAndPercentile = (entry: (typeof rawAll)[number]): PeerComparisonEntry => {
    const rank = sortedByMarketCap.findIndex((e) => e.symbol === entry.symbol) + 1;
    let percentile = 0;
    if (entry.marketCap != null && totalCompanies > 0) {
      const smallerOrEqual = rawAll.filter(
        (other) => other.marketCap != null && other.marketCap <= entry.marketCap!
      ).length;
      percentile = Math.round((smallerOrEqual / totalCompanies) * 100);
    }
    return {
      ...entry,
      rank,
      percentile,
    };
  };

  const targetEntry = assignRankAndPercentile(rawTargetEntry);
  const peerEntries = rawPeerEntries.map(assignRankAndPercentile);

  const medians = computeMedians(peerEntries);
  const comparisonMedian = computeMedians([targetEntry, ...peerEntries]);

  // Determine asOf: newest quote timestamp across all returned entries
  const quoteTimestamps = [targetEntry, ...peerEntries]
    .map((e) => e.latestQuoteAt)
    .filter((t): t is string => Boolean(t))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const asOf = quoteTimestamps[0] ?? null;

  return {
    target: targetEntry,
    peers: peerEntries,
    medians,
    comparisonMedian,
    sectorMedian: comparisonMedian,
    selectionBasis,
    selectionLabel,
    asOf,
    generatedAt: new Date().toISOString(),
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

async function selectPeers(target: RawCompany, limit: number): Promise<PeerSelection> {
  // Pass 1: same industry
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
      );

    if (sameIndustry.length > 0) {
      const selected = rankByMarketCap(sameIndustry, target, limit);
      return {
        peers: selected,
        selectionBasis: "industry",
        selectionLabel: target.industry,
      };
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
      );

    if (sameSector.length > 0) {
      const selected = rankByMarketCap(sameSector, target, limit);
      return {
        peers: selected,
        selectionBasis: "sector",
        selectionLabel: target.sector,
      };
    }
  }

  return {
    peers: [],
    selectionBasis: "none",
    selectionLabel: "None",
  };
}

function rankByMarketCap(
  candidates: RawCompany[],
  target: RawCompany,
  limit: number
): RawCompany[] {
  const targetMc = target.marketCap ? Number(target.marketCap) : null;

  return candidates
    .slice()
    .sort((a, b) => {
      const aMc = a.marketCap != null ? Number(a.marketCap) : null;
      const bMc = b.marketCap != null ? Number(b.marketCap) : null;

      if (targetMc != null && !isNaN(targetMc)) {
        const aDist = aMc != null && !isNaN(aMc) ? Math.abs(aMc - targetMc) : Infinity;
        const bDist = bMc != null && !isNaN(bMc) ? Math.abs(bMc - targetMc) : Infinity;
        if (aDist !== bDist) {
          return aDist - bDist;
        }
      } else {
        const aVal = aMc != null && !isNaN(aMc) ? aMc : -Infinity;
        const bVal = bMc != null && !isNaN(bMc) ? bMc : -Infinity;
        if (aVal !== bVal) {
          return bVal - aVal; // descending
        }
      }

      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}

function buildEntry(
  c: RawCompany,
  isTarget: boolean,
  fundMap: Map<string, any>,
  quoteMap: Map<string, any>
): Omit<PeerComparisonEntry, "rank" | "percentile"> {
  const fund = fundMap.get(c.id);
  const quote = quoteMap.get(c.id);

  const parseNum = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };

  const metrics: PeerMetric = {
    marketCap: parseNum(c.marketCap),
    peRatio: parseNum(fund?.peRatio),
    pbRatio: parseNum(fund?.pbRatio),
    enterpriseValueToEbitda: parseNum(fund?.enterpriseValueToEbitda),
    roe: parseNum(fund?.roe),
    roce: parseNum(fund?.roce),
    revenueGrowth: parseNum(fund?.revenueGrowth),
    epsGrowth: parseNum(fund?.epsGrowth),
    netMargin: parseNum(fund?.netMargin),
    debtToEquity: parseNum(fund?.debtToEquity),
    freeCashFlowYield: parseNum(fund?.freeCashFlowYield),
    relativeVolume: parseNum(fund?.relativeVolume),
    priceMomentum3m: undefined,
    priceMomentum1y: undefined,
  };

  const metricValues = [
    metrics.marketCap,
    metrics.peRatio,
    metrics.pbRatio,
    metrics.enterpriseValueToEbitda,
    metrics.roe,
    metrics.roce,
    metrics.revenueGrowth,
    metrics.epsGrowth,
    metrics.netMargin,
    metrics.debtToEquity,
    metrics.freeCashFlowYield,
    metrics.relativeVolume,
    metrics.priceMomentum3m,
    metrics.priceMomentum1y,
  ];

  const definedCount = metricValues.filter((v) => v !== undefined).length;
  const dataCoverage = Math.round((definedCount / metricValues.length) * 100) / 100;

  return {
    symbol: c.symbol,
    name: c.name,
    sector: c.sector,
    industry: c.industry,
    marketCap: parseNum(c.marketCap) ?? null,
    isTarget,
    metrics,
    dataCoverage,
    latestFundamentalsAt: toIsoOrNull(fund?.periodDate),
    latestQuoteAt: toIsoOrNull(quote?.asOf),
  };
}

function computeMedians(entries: PeerComparisonEntry[]): PeerMetric {
  if (entries.length === 0) return {};

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
    "priceMomentum3m",
    "priceMomentum1y",
  ];

  const out: PeerMetric = {};
  for (const key of keys) {
    const values = entries
      .map((e) => e.metrics[key])
      .filter((v): v is number => typeof v === "number" && !isNaN(v))
      .sort((a, b) => a - b);

    if (values.length === 0) continue;

    const mid = Math.floor(values.length / 2);
    out[key] =
      values.length % 2 === 0
        ? Number(((values[mid - 1] + values[mid]) / 2).toFixed(4))
        : values[mid];
  }
  return out;
}