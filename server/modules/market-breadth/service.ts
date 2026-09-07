import { fetchMarketQuotesWithFundamentals, type VerifiedQuoteData } from "./repository";

export interface HeatmapCell {
  symbol: string;
  name: string;
  sector: string;
  marketCap?: number;
  sizeEligible: boolean;
  weight: number;
  price: number;
  changePct: number;
  source: string;
  asOf: string;
}

export interface HeatmapResult {
  available: boolean;
  reason?: string;
  universe: string;
  cells: HeatmapCell[];
  asOf: string;
  generatedAt: string;
}

export interface BreadthOverview {
  available: boolean;
  reason?: string;
  universe: string;
  eligibleCompanies: number;
  companiesWithUsableQuote: number;
  quoteCoverage: number;
  advances: number;
  declines: number;
  unchanged: number;
  advanceDeclineRatio: number | null;
  new20DayHigh: number;
  new20DayLow: number;
  eligible20dSessions: number;
  aboveSma20: number;
  aboveSma50: number;
  aboveSma200: number;
  sma20Eligible: number;
  sma50Eligible: number;
  sma200Eligible: number;
  pctAboveSma20: number;
  pctAboveSma50: number;
  pctAboveSma200: number;
  averageChange: number;
  medianChange: number;
  marketCapWeightedChange: number;
  marketCapCoverage: number;
  sectorContribution: Record<string, { count: number; avgChange: number; weight: number }>;
  excludedCount: number;
  dataCoverage: number;
  newestQuoteAt: string | null;
  oldestQuoteAt: string | null;
  asOf: string;
  generatedAt: string;
}

export async function calculateMarketBreadth(universe = "ALL_NSE"): Promise<BreadthOverview> {
  const generatedAt = new Date().toISOString();
  const result = await fetchMarketQuotesWithFundamentals(universe);

  if (!result.available) {
    return {
      available: false,
      reason: result.reason,
      universe,
      eligibleCompanies: 0,
      companiesWithUsableQuote: 0,
      quoteCoverage: 0,
      advances: 0,
      declines: 0,
      unchanged: 0,
      advanceDeclineRatio: null,
      new20DayHigh: 0,
      new20DayLow: 0,
      eligible20dSessions: 0,
      aboveSma20: 0,
      aboveSma50: 0,
      aboveSma200: 0,
      sma20Eligible: 0,
      sma50Eligible: 0,
      sma200Eligible: 0,
      pctAboveSma20: 0,
      pctAboveSma50: 0,
      pctAboveSma200: 0,
      averageChange: 0,
      medianChange: 0,
      marketCapWeightedChange: 0,
      marketCapCoverage: 0,
      sectorContribution: {},
      excludedCount: 0,
      dataCoverage: 0,
      newestQuoteAt: null,
      oldestQuoteAt: null,
      asOf: generatedAt,
      generatedAt,
    };
  }

  const data = result.data;
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let totalUsableMarketCapWithChange = 0;
  let weightedChangeSum = 0;
  let new20DayHigh = 0;
  let new20DayLow = 0;
  let aboveSma20 = 0;
  let aboveSma50 = 0;
  let aboveSma200 = 0;

  const changes: number[] = [];
  const sectorMap: Record<string, { count: number; changeSum: number; mcSum: number }> = {};

  for (const item of data) {
    changes.push(item.changePct);

    // Only verified positive market caps participate in market cap weighting
    if (item.marketCap && item.marketCap > 0 && !isNaN(item.changePct)) {
      totalUsableMarketCapWithChange += item.marketCap;
      weightedChangeSum += item.changePct * item.marketCap;
    }

    if (item.changePct > 0) advances++;
    else if (item.changePct < 0) declines++;
    else unchanged++;

    // Trailing 20-session high/low from daily candles
    if (item.high20d !== undefined && item.price >= item.high20d) new20DayHigh++;
    if (item.low20d !== undefined && item.price <= item.low20d) new20DayLow++;

    // SMA comparisons - only when company is eligible
    if (item.sma20 !== undefined && item.price > item.sma20) aboveSma20++;
    if (item.sma50 !== undefined && item.price > item.sma50) aboveSma50++;
    if (item.sma200 !== undefined && item.price > item.sma200) aboveSma200++;

    if (!sectorMap[item.sector]) {
      sectorMap[item.sector] = { count: 0, changeSum: 0, mcSum: 0 };
    }
    sectorMap[item.sector].count++;
    sectorMap[item.sector].changeSum += item.changePct;
    if (item.marketCap && item.marketCap > 0) {
      sectorMap[item.sector].mcSum += item.marketCap;
    }
  }

  changes.sort((a, b) => a - b);
  const mid = Math.floor(changes.length / 2);
  const medianChange = changes.length > 0
    ? changes.length % 2 === 0
      ? Number(((changes[mid - 1] + changes[mid]) / 2).toFixed(2))
      : Number(changes[mid].toFixed(2))
    : 0;
  const averageChange = changes.length > 0
    ? Number((changes.reduce((a, b) => a + b, 0) / changes.length).toFixed(2))
    : 0;

  const marketCapWeightedChange = totalUsableMarketCapWithChange > 0
    ? Number((weightedChangeSum / totalUsableMarketCapWithChange).toFixed(2))
    : 0;

  const marketCapCoverage = result.totalEligibleMarketCap > 0
    ? Number((totalUsableMarketCapWithChange / result.totalEligibleMarketCap).toFixed(4))
    : 0;

  // Advance / decline ratio: null if declines === 0 (truthful mathematical representation)
  const advanceDeclineRatio = declines > 0
    ? Number((advances / declines).toFixed(2))
    : null;

  const pctAboveSma20 = result.sma20Eligible > 0
    ? Number(((aboveSma20 / result.sma20Eligible) * 100).toFixed(2))
    : 0;
  const pctAboveSma50 = result.sma50Eligible > 0
    ? Number(((aboveSma50 / result.sma50Eligible) * 100).toFixed(2))
    : 0;
  const pctAboveSma200 = result.sma200Eligible > 0
    ? Number(((aboveSma200 / result.sma200Eligible) * 100).toFixed(2))
    : 0;

  const sectorContribution: Record<string, { count: number; avgChange: number; weight: number }> = {};
  for (const [sector, stat] of Object.entries(sectorMap)) {
    sectorContribution[sector] = {
      count: stat.count,
      avgChange: Number((stat.changeSum / stat.count).toFixed(2)),
      weight: totalUsableMarketCapWithChange > 0
        ? Number(((stat.mcSum / totalUsableMarketCapWithChange) * 100).toFixed(2))
        : 0,
    };
  }

  // Provenance quote timestamps
  const quoteTimestamps = data
    .map((d) => d.asOf)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const newestQuoteAt = quoteTimestamps[0] ?? null;
  const oldestQuoteAt = quoteTimestamps[quoteTimestamps.length - 1] ?? null;
  const asOf = newestQuoteAt ?? generatedAt;

  return {
    available: true,
    universe,
    eligibleCompanies: result.eligibleCompanies,
    companiesWithUsableQuote: result.companiesWithUsableQuote,
    quoteCoverage: result.quoteCoverage,
    advances,
    declines,
    unchanged,
    advanceDeclineRatio,
    new20DayHigh,
    new20DayLow,
    eligible20dSessions: result.eligible20dSessions,
    aboveSma20,
    aboveSma50,
    aboveSma200,
    sma20Eligible: result.sma20Eligible,
    sma50Eligible: result.sma50Eligible,
    sma200Eligible: result.sma200Eligible,
    pctAboveSma20,
    pctAboveSma50,
    pctAboveSma200,
    averageChange,
    medianChange,
    marketCapWeightedChange,
    marketCapCoverage,
    sectorContribution,
    excludedCount: result.excludedCount,
    dataCoverage: result.dataCoverage,
    newestQuoteAt,
    oldestQuoteAt,
    asOf,
    generatedAt,
  };
}

export async function getHeatmapCells(universe = "ALL_NSE"): Promise<HeatmapResult> {
  const generatedAt = new Date().toISOString();
  const result = await fetchMarketQuotesWithFundamentals(universe);

  if (!result.available) {
    return {
      available: false,
      reason: result.reason,
      cells: [],
      universe,
      asOf: generatedAt,
      generatedAt,
    };
  }

  const data = result.data;
  const totalMarketCap = data.reduce(
    (acc, item) => acc + (item.marketCap && item.marketCap > 0 ? item.marketCap : 0),
    0
  );

  const cells: HeatmapCell[] = data.map((item) => {
    const sizeEligible = Boolean(item.marketCap && item.marketCap > 0);
    const weight = sizeEligible && totalMarketCap > 0
      ? Number(((item.marketCap! / totalMarketCap) * 100).toFixed(4))
      : 0;

    return {
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      marketCap: item.marketCap,
      sizeEligible,
      weight,
      price: item.price,
      changePct: item.changePct,
      source: item.source,
      asOf: item.asOf,
    };
  });

  // Provenance quote timestamps
  const quoteTimestamps = data
    .map((d) => d.asOf)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const newestQuoteAt = quoteTimestamps[0] ?? null;
  const asOf = newestQuoteAt ?? generatedAt;

  return {
    available: true,
    cells,
    universe,
    asOf,
    generatedAt,
  };
}
