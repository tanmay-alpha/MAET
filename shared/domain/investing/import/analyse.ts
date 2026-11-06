import { buildCapitalGainsReport, matchFifoPositions, twelveMonthAnniversary, type CapitalGainsReport, type Fill } from "../capital-gains";
import { xirr } from "../xirr";
import type { CsvRow } from "./csv";
import { financialYearStart, ltcgEligibleFrom } from "./dates";
import { normalizeRows, type BrokerFormat, type ColumnMapping, type ParsedTrade, type RowResult } from "./normalize";

/**
 * Imported trades are matched per symbol across NSE and BSE: a demat holding is
 * one pool regardless of the exchange it was bought on. The engine isolates
 * FIFO by exchange, so every fill carries this one exchange key.
 */
const DEMAT = "DEMAT";
/** The engine filters by account generation; an imported file is a single one. */
const GENERATION = 0;

export interface Holding {
  symbol: string;
  quantity: number;
  invested: number;
  avgCost: number;
  lots: number;
  oldestLotDate: string;
  /** Sale date from which the oldest open lot is long-term. */
  ltcgEligibleFrom: string;
  /** Sale date from which every open lot is long-term. */
  fullyLtcgEligibleFrom: string;
}

export interface RoundTrip {
  symbol: string;
  quantity: number;
  buyDate: string;
  sellDate: string;
  buyValue: number;
  sellValue: number;
  gain: number;
  term: "Intraday" | "STCG" | "LTCG";
  financialYearStart: number;
}

export interface ImportAnalysis {
  rows: RowResult[];
  counts: { parsed: number; accepted: number; rejected: number; duplicates: number };
  /** Accepted trades in the chronological order fed to FIFO. */
  trades: ParsedTrade[];
  holdings: Holding[];
  trips: RoundTrip[];
  /** Exit financial years that have realised trips, newest first. */
  financialYears: number[];
  /** The portfolio page's capital-gains report, computed over this file's fills. */
  taxReport: (financialYearStart: number) => CapitalGainsReport;
}

const chronological = (left: ParsedTrade, right: ParsedTrade) =>
  left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.line - right.line;

/**
 * The engine would open a short for an oversized sell; a delivery tradebook
 * cannot sell what it never bought (missing history, transfers, IPO allotments).
 * Such sells are rejected whole, before FIFO, against the quantity held then.
 */
function rejectOversells(trades: ParsedTrade[]): Map<number, string> {
  const held = new Map<string, number>();
  const rejected = new Map<number, string>();
  for (const trade of trades) {
    const quantity = held.get(trade.symbol) ?? 0;
    if (trade.side === "BUY") held.set(trade.symbol, quantity + trade.quantity);
    else if (trade.quantity > quantity) rejected.set(trade.line, `Sell without prior buy: ${trade.quantity} sold, ${quantity} held`);
    else held.set(trade.symbol, quantity - trade.quantity);
  }
  return rejected;
}

export function analyseImport(format: BrokerFormat, headers: readonly string[], dataRows: readonly CsvRow[], mapping?: ColumnMapping): ImportAnalysis {
  const normalized = normalizeRows(format, headers, dataRows, mapping);
  const candidates = normalized.flatMap((row) => (row.trade ? [row.trade] : [])).sort(chronological);
  const oversells = rejectOversells(candidates);
  const rows = normalized.map((row): RowResult => {
    const reason = oversells.get(row.line);
    return reason ? { line: row.line, cells: row.cells, status: "rejected", reason } : row;
  });
  const trades = candidates.filter((trade) => !oversells.has(trade.line));

  const fills: Fill[] = trades.map((trade) => ({
    id: String(trade.line), generation: GENERATION, symbol: trade.symbol, exchange: DEMAT,
    side: trade.side, quantity: trade.quantity, price: trade.price, date: trade.date,
  }));
  const { matched, open } = matchFifoPositions(fills, GENERATION);

  const trips = matched.map((lot): RoundTrip => ({
    symbol: lot.symbol,
    quantity: lot.quantity,
    buyDate: lot.entryDate,
    sellDate: lot.exitDate,
    buyValue: lot.quantity * lot.entryPrice,
    sellValue: lot.quantity * lot.exitPrice,
    gain: lot.grossPnl,
    term: lot.kind === "intraday" ? "Intraday" : lot.exitDate > twelveMonthAnniversary(lot.entryDate) ? "LTCG" : "STCG",
    financialYearStart: financialYearStart(lot.exitDate),
  }));

  const holdings = new Map<string, Holding>();
  for (const lot of open) {
    const holding = holdings.get(lot.symbol);
    if (!holding) {
      const eligible = ltcgEligibleFrom(lot.date);
      holdings.set(lot.symbol, {
        symbol: lot.symbol, quantity: lot.quantity, invested: lot.quantity * lot.price, avgCost: lot.price, lots: 1,
        oldestLotDate: lot.date, ltcgEligibleFrom: eligible, fullyLtcgEligibleFrom: eligible,
      });
      continue;
    }
    // Open lots arrive oldest first per symbol, so the latest one sets full eligibility.
    holding.quantity += lot.quantity;
    holding.invested += lot.quantity * lot.price;
    holding.avgCost = holding.invested / holding.quantity;
    holding.lots += 1;
    holding.fullyLtcgEligibleFrom = ltcgEligibleFrom(lot.date);
  }

  const count = (status: RowResult["status"]) => rows.filter((row) => row.status === status).length;
  return {
    rows,
    counts: { parsed: rows.length, accepted: count("accepted"), rejected: count("rejected"), duplicates: count("duplicate") },
    trades,
    holdings: [...holdings.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    trips,
    financialYears: [...new Set(trips.map((trip) => trip.financialYearStart))].sort((left, right) => right - left),
    taxReport: (year) => buildCapitalGainsReport(fills, year, GENERATION),
  };
}

export interface CashFlow {
  date: string;
  amount: number;
  label: string;
}

/**
 * Money-weighted return of the file: buys are outflows, sells inflows, and
 * the open holdings a terminal inflow at the user's prices on asOf. Gross of
 * charges, like the capital-gains figures. Needs a price for every holding.
 */
export function cashFlowReturn(analysis: ImportAnalysis, prices: Readonly<Record<string, number>>, asOf: string) {
  const flows: CashFlow[] = analysis.trades.map((trade) => ({
    date: trade.date,
    amount: (trade.side === "BUY" ? -1 : 1) * trade.quantity * trade.price,
    label: `${trade.side === "BUY" ? "Buy" : "Sell"} ${trade.symbol}`,
  }));
  const missing = analysis.holdings.filter((holding) => !(prices[holding.symbol]! > 0)).map((holding) => holding.symbol);
  if (missing.length > 0) return { flows, missing, xirr: null };
  if (analysis.holdings.length > 0) {
    const value = analysis.holdings.reduce((total, holding) => total + holding.quantity * prices[holding.symbol]!, 0);
    flows.push({ date: asOf, amount: value, label: "Holdings at current price" });
  }
  return { flows, missing, xirr: xirr(flows) };
}
