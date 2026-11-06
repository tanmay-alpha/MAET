import { and, asc, eq } from "drizzle-orm";
import { buildCapitalGainsReport, type Fill, type CapitalGainsReport, type MatchedLot } from "@shared/domain/investing/capital-gains";
import { xirr } from "@shared/domain/investing/xirr";
import { getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperPositions } from "../../db/schema";
import { istDateKey } from "../../domain/market/clock";
import type { PaperDatabase } from "./repository";
import { loadSnapshotPrice, valuePosition, type SnapshotPriceLoader } from "./portfolio-snapshots";

export interface PaperInvestingReportDependencies {
  database?: PaperDatabase;
  now?: () => Date;
  loadPrice?: SnapshotPriceLoader;
}

export interface PaperInvestingReport {
  account: { generation: number; initialCash: number; equity: number; startedAt: string } | null;
  portfolioXirr: number | null;
  xirrReason: string | null;
  today: string;
  financialYears: number[];
  tax: CapitalGainsReport;
  closedLots: (MatchedLot & { xirr: number | null })[];
  stalePrices: boolean;
  /** Oldest open-position mark; null if an entry-price fallback has no timestamp. */
  valuationAsOf: string | null;
}

export function financialYearFor(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

/** Reads one repeatable snapshot; never initialises accounts, writes snapshots or changes fills. */
export class PaperInvestingReportService {
  private readonly database: () => PaperDatabase;
  private readonly now: () => Date;
  private readonly loadPrice: SnapshotPriceLoader;

  constructor(deps: PaperInvestingReportDependencies = {}) {
    this.database = deps.database ? () => deps.database! : () => getDb();
    this.now = deps.now ?? (() => new Date());
    this.loadPrice = deps.loadPrice ?? loadSnapshotPrice;
  }

  async getReport(userId: string, options: { financialYearStart?: number } = {}): Promise<PaperInvestingReport> {
    const now = this.now();
    const today = istDateKey(now);
    const selectedYear = options.financialYearStart ?? financialYearFor(today);
    const state = await this.database().transaction(async (tx) => {
      const [account] = await tx.select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
      if (!account) return null;
      const positions = await tx.select().from(paperPositions)
        .where(and(eq(paperPositions.userId, userId), eq(paperPositions.generation, account.generation)));
      // Complete generation history is needed: acquisition lots may precede the selected FY.
      const fills = await tx.select().from(paperFills)
        .where(and(eq(paperFills.userId, userId), eq(paperFills.generation, account.generation)))
        .orderBy(asc(paperFills.executedAt), asc(paperFills.createdAt), asc(paperFills.id));
      return { account, positions, fills };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    const fills: Fill[] = (state?.fills ?? []).map((fill) => ({
      id: fill.id, generation: fill.generation, symbol: fill.symbol, exchange: fill.exchange,
      side: fill.side, quantity: fill.quantity, price: Number(fill.fillPrice),
      date: istDateKey(fill.executedAt), fee: Number(fill.fees),
    }));
    const generation = state?.account.generation ?? 1;
    const tax = buildCapitalGainsReport(fills, selectedYear, generation);
    const financialYears = [...new Set([financialYearFor(today), selectedYear, ...fills.map((f) => financialYearFor(f.date))])]
      .sort((a, b) => b - a);
    const closedLots = tax.matchedLots.map((lot) => ({
      ...lot,
      // Sale proceeds are not capital invested in a short; do not invent a short-sale XIRR.
      xirr: lot.side === "LONG" ? xirr([
        { amount: -lot.entryPrice * lot.quantity, date: lot.entryDate },
        { amount: lot.exitPrice * lot.quantity, date: lot.exitDate },
      ]) : null,
    }));
    if (!state) return {
      account: null, portfolioXirr: null, xirrReason: "No paper account yet.",
      today, financialYears, tax, closedLots, stalePrices: false, valuationAsOf: null,
    };
    const prices = await Promise.all(state.positions.filter((p) => p.totalShares !== 0).map(async (position) => {
      const quote = await this.loadPrice(position.exchange === "BSE" ? "BSE" : "NSE", position.symbol);
      return valuePosition(position, quote, { date: today, isFinal: false });
    }));
    let valuationAsOf = prices.length === 0 ? now.toISOString() : prices[0]!.asOf;
    for (const price of prices) {
      if (price.asOf === null) {
        valuationAsOf = null;
        break;
      }
      if (valuationAsOf !== null && price.asOf < valuationAsOf) valuationAsOf = price.asOf;
    }
    // The paper engine is cash-settled: principal is not debited when opening a position.
    // Fees and realised P&L are already in cash; adding either would double-count them.
    const equity = Math.round((Number(state.account.cashBalance) + prices.reduce((sum, p) => sum + p.unrealizedPnl, 0)) * 10_000) / 10_000;
    const startedAt = istDateKey(state.account.resetAt ?? state.account.createdAt);
    const portfolioXirr = xirr([
      { amount: -Number(state.account.initialCash), date: startedAt }, { amount: equity, date: today },
    ]);
    return {
      account: { generation, initialCash: Number(state.account.initialCash), equity, startedAt },
      portfolioXirr,
      xirrReason: portfolioXirr === null ? (startedAt === today ? "Available after the first calendar day." : "No finite annualised return for these cash flows.") : null,
      today, financialYears, tax, closedLots, stalePrices: prices.some((p) => p.stale), valuationAsOf,
    };
  }
}

export function createPaperInvestingReportService(deps: PaperInvestingReportDependencies = {}) {
  return new PaperInvestingReportService(deps);
}
