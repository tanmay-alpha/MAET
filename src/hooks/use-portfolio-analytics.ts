import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { useSignedIn } from "@/hooks/use-signed-in";
import { createQueryProcedure } from "@/lib/trpc";
import { curveToHistory, type PerformanceDataPoint } from "@/lib/portfolio-curve";
import type { PaperAccountRow, PaperPositionRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";
import type { PortfolioAnalyticsResult } from "../../server/modules/paper-trading/portfolio-analytics-contracts";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";
import type { MarketQuote } from "@/lib/market-api";

export type {
  DrawdownResult,
  MetricResult,
  PortfolioAnalyticsResult,
  PortfolioCurvePoint,
  PortfolioMetrics,
} from "../../server/modules/paper-trading/portfolio-analytics-contracts";

export interface PerformanceMetrics {
  totalValue: number;
  totalCost: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  dayPnl: number;
  dayPnlPct: number;
  cash: number;
  positionsValue: number;
}

export interface TradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  avgHoldingDays: number;
}

export interface PortfolioAnalytics {
  /** Live valuation of the open account from current quotes; null until the account loads. */
  metrics: PerformanceMetrics | null;
  trades: TradeStats;
  /** Daily equity curve of the current account generation, from server snapshots. */
  history: PerformanceDataPoint[];
  /** Server-computed curve metrics; undefined until loaded (or while signed out). */
  performance: PortfolioAnalyticsResult | undefined;
  isPerformanceLoading: boolean;
  performanceError: string | null;
  signedIn: boolean;
  hasData: boolean;
}

const portfolioAnalyticsProcedure = createQueryProcedure<{ riskFreeRate?: number }, PortfolioAnalyticsResult>(
  "paperTrading.portfolioAnalytics"
);

/**
 * Server equity curve and metrics for the signed-in user; shares the
 * ["paperTrading"] key so trades and resets refresh it. Not requested while
 * signed out: the procedure can only answer 401.
 */
export function usePortfolioPerformance(riskFreeRate = 0) {
  const signedIn = useSignedIn();
  const query = useQuery({
    queryKey: ["paperTrading", "portfolioAnalytics", riskFreeRate],
    queryFn: () => portfolioAnalyticsProcedure.query({ riskFreeRate }),
    enabled: signedIn,
    staleTime: 60_000,
    retry: 1,
  });
  return { query, signedIn };
}

function valueAccount(
  account: PaperAccountRow,
  positions: PaperPositionRow[],
  quoteMap: ReadonlyMap<string, MarketQuote>
): PerformanceMetrics {
  let unrealizedPnl = 0;
  let positionsValue = 0;
  let dayPnl = 0;

  const cash = Number(account.cashBalance);
  const initialCash = Number(account.initialCash);
  const realisedPnl = Number(account.realisedPnl);

  positions.forEach((position: PaperPositionRow) => {
    const quote = quoteMap.get(position.symbol);
    const avgPrice = Number(position.averageEntryPrice);
    const currentPrice = quote?.price || avgPrice;
    const prevPrice = quote?.previousClose;

    const isShort = position.side === "SHORT" || position.totalShares < 0;
    const absQty = Math.abs(position.totalShares);
    const signedQty = isShort ? -absQty : absQty;

    positionsValue += currentPrice * absQty;
    unrealizedPnl += calculateMarkedUnrealisedPnl(
      { quantity: signedQty, averagePrice: avgPrice },
      currentPrice
    );

    if (prevPrice && prevPrice > 0) {
      dayPnl += isShort
        ? (prevPrice - currentPrice) * absQty
        : (currentPrice - prevPrice) * absQty;
    }
  });

  const totalValue = cash + unrealizedPnl;
  const totalCost = initialCash;
  const totalPnl = unrealizedPnl + realisedPnl;
  return {
    totalValue,
    totalCost,
    unrealizedPnl,
    realizedPnl: realisedPnl,
    totalPnl,
    totalReturnPct: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    dayPnl,
    dayPnlPct: totalValue > 0 ? (dayPnl / totalValue) * 100 : 0,
    cash,
    positionsValue,
  };
}

/**
 * Win/loss statistics over closing fills. Opening and increasing fills book no
 * realised P&L (the engine records 0 for them), so a round trip counts once —
 * by the fill that realised it.
 */
export function tradeStatsFromFills(fills: readonly Pick<PaperFillRow, "realizedPnl">[]): TradeStats {
  const tradePnlList = fills
    .map((f) => Number(f.realizedPnl))
    .filter((pnl) => Number.isFinite(pnl) && pnl !== 0);
  const winningTrades = tradePnlList.filter((p) => p > 0);
  const losingTrades = tradePnlList.filter((p) => p < 0);
  const totalTrades = tradePnlList.length;
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((a, b) => a + b, 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((a, b) => a + b, 0) / losingTrades.length
    : 0;
  const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades) : 0;
  const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades) : 0;

  const totalWins = winningTrades.reduce((a, b) => a + b, 0);
  const totalLosses = Math.abs(losingTrades.reduce((a, b) => a + b, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  return {
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    profitFactor,
    avgHoldingDays: 0,
  };
}

export function usePortfolioAnalytics(): PortfolioAnalytics {
  const { account, positions, orders, fills } = usePaperAccount();
  const { query: performanceQuery, signedIn } = usePortfolioPerformance();

  const positionSymbols = useMemo(
    () => [...new Set(positions.map((p: PaperPositionRow) => p.symbol))],
    [positions]
  );

  const { quoteMap } = useMarketQuotes(positionSymbols);

  const live = useMemo(() => {
    // Valuation needs the server's account: there is no default balance to value against.
    const metrics = account ? valueAccount(account, positions, quoteMap) : null;

    const trades = tradeStatsFromFills(fills);

    const hasData = orders.length > 0 || positions.length > 0 || fills.length > 0;

    return { metrics, trades, hasData };
  }, [account, positions, orders, fills, quoteMap]);

  const performance = performanceQuery.data;
  const history = useMemo(() => curveToHistory(performance), [performance]);

  return {
    ...live,
    history,
    performance,
    isPerformanceLoading: performanceQuery.isLoading,
    performanceError: performanceQuery.error?.message ?? null,
    signedIn,
  };
}
