import { fetchMarketQuotesWithFundamentals, type VerifiedQuoteData } from "./repository";

export interface HeatmapCell {
  symbol: string;
  name: string;
  sector: string;
  marketCap?: number;
  weight: number;
  price: number;
  changePct: number;
  source: string;
  asOf: string;
}

export interface BreadthOverview {
  available: boolean;
  reason?: string;
  advances: number;
  declines: number;
  unchanged: number;
  advanceDeclineRatio: number;
  new20DayHigh: number;
  new20DayLow: number;
  aboveSma20: number;
  aboveSma50: number;
  aboveSma200: number;
  averageChange: number;
  medianChange: number;
  marketCapWeightedChange: number;
  sectorContribution: Record<string, { count: number; avgChange: number; weight: number }>;
  excludedCount: number;
  dataCoverage: number;
  asOf: string;
}

export async function calculateMarketBreadth(universe = "ALL_NSE"): Promise<BreadthOverview> {
  const result = await fetchMarketQuotesWithFundamentals(universe);

  if (!result.available) {
    return {
      available: false,
      reason: result.reason,
      advances: 0,
      declines: 0,
      unchanged: 0,
      advanceDeclineRatio: 0,
      new20DayHigh: 0,
      new20DayLow: 0,
      aboveSma20: 0,
      aboveSma50: 0,
      aboveSma200: 0,
      averageChange: 0,
      medianChange: 0,
      marketCapWeightedChange: 0,
      sectorContribution: {},
      excludedCount: 0,
      dataCoverage: 0,
      asOf: new Date().toISOString(),
    };
  }

  const data = result.data;
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let totalMarketCap = 0;
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
    if (item.marketCap) {
      totalMarketCap += item.marketCap;
      weightedChangeSum += item.changePct * item.marketCap;
    }

    if (item.changePct > 0) advances++;
    else if (item.changePct < 0) declines++;
    else unchanged++;

    if (item.high20d !== undefined && item.price >= item.high20d) new20DayHigh++;
    if (item.low20d !== undefined && item.price <= item.low20d) new20DayLow++;
    if (item.sma20 !== undefined && item.price > item.sma20) aboveSma20++;
    if (item.sma50 !== undefined && item.price > item.sma50) aboveSma50++;
    if (item.sma200 !== undefined && item.price > item.sma200) aboveSma200++;

    if (!sectorMap[item.sector]) {
      sectorMap[item.sector] = { count: 0, changeSum: 0, mcSum: 0 };
    }
    sectorMap[item.sector].count++;
    sectorMap[item.sector].changeSum += item.changePct;
    if (item.marketCap) {
      sectorMap[item.sector].mcSum += item.marketCap;
    }
  }

  changes.sort((a, b) => a - b);
  const mid = Math.floor(changes.length / 2);
  const medianChange = changes.length > 0 ? (changes.length % 2 === 0 ? (changes[mid - 1] + changes[mid]) / 2 : changes[mid]) : 0;
  const averageChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
  const marketCapWeightedChange = totalMarketCap > 0 ? weightedChangeSum / totalMarketCap : 0;
  const advanceDeclineRatio = declines > 0 ? Math.round((advances / declines) * 100) / 100 : advances;

  const sectorContribution: Record<string, { count: number; avgChange: number; weight: number }> = {};
  for (const [sector, stat] of Object.entries(sectorMap)) {
    sectorContribution[sector] = {
      count: stat.count,
      avgChange: Math.round((stat.changeSum / stat.count) * 100) / 100,
      weight: totalMarketCap > 0 ? Math.round((stat.mcSum / totalMarketCap) * 10000) / 100 : 0,
    };
  }

  return {
    available: true,
    advances,
    declines,
    unchanged,
    advanceDeclineRatio,
    new20DayHigh,
    new20DayLow,
    aboveSma20,
    aboveSma50,
    aboveSma200,
    averageChange: Math.round(averageChange * 100) / 100,
    medianChange: Math.round(medianChange * 100) / 100,
    marketCapWeightedChange: Math.round(marketCapWeightedChange * 100) / 100,
    sectorContribution,
    excludedCount: result.excludedCount,
    dataCoverage: result.dataCoverage,
    asOf: new Date().toISOString(),
  };
}

export async function getHeatmapCells(universe = "ALL_NSE"): Promise<{ available: boolean; reason?: string; cells: HeatmapCell[]; universe: string; asOf: string }> {
  const result = await fetchMarketQuotesWithFundamentals(universe);

  if (!result.available) {
    return {
      available: false,
      reason: result.reason,
      cells: [],
      universe,
      asOf: new Date().toISOString(),
    };
  }

  const data = result.data;
  const totalMarketCap = data.reduce((acc, item) => acc + (item.marketCap ?? 0), 0);

  const cells: HeatmapCell[] = data.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    sector: item.sector,
    marketCap: item.marketCap,
    weight: totalMarketCap > 0 && item.marketCap ? Math.round((item.marketCap / totalMarketCap) * 10000) / 100 : 0,
    price: item.price,
    changePct: item.changePct,
    source: item.source,
    asOf: item.asOf,
  }));

  return {
    available: true,
    cells,
    universe,
    asOf: new Date().toISOString(),
  };
}
