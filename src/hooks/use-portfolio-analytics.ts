import { useMemo } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import type { PaperPositionRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";

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

export interface RiskMetrics {
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  volatility: number | null;
  beta: number | null;
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

export interface PerformanceDataPoint {
  date: string;
  value: number;
  pnl: number;
}

export interface PortfolioAnalytics {
  metrics: PerformanceMetrics;
  risk: RiskMetrics;
  trades: TradeStats;
  history: PerformanceDataPoint[];
  hasData: boolean;
}

export function usePortfolioAnalytics() {
  const { account, positions, orders, fills } = usePaperAccount();

  const positionSymbols = useMemo(
    () => [...new Set(positions.map((p: PaperPositionRow) => p.symbol))],
    [positions]
  );

  const { quoteMap } = useMarketQuotes(positionSymbols);

  const analytics = useMemo<PortfolioAnalytics>(() => {
    let unrealizedPnl = 0;
    let positionsValue = 0;
    let positionsCost = 0;
    let dayPnl = 0;

    const cash = account ? Number(account.cashBalance) : 1000000;
    const initialCash = account ? Number(account.initialCash) : 1000000;
    const realisedPnl = account ? Number(account.realisedPnl) : 0;

    positions.forEach((position: PaperPositionRow) => {
      const quote = quoteMap.get(position.symbol);
      const avgPrice = Number(position.averageEntryPrice);
      const currentPrice = quote?.price || avgPrice;
      const prevPrice = quote?.previousClose;

      const qty = position.totalShares;
      positionsValue += currentPrice * qty;
      positionsCost += avgPrice * qty;
      unrealizedPnl += (currentPrice - avgPrice) * qty;

      if (prevPrice && prevPrice > 0) {
        dayPnl += (currentPrice - prevPrice) * qty;
      }
    });

    const totalValue = cash + positionsValue;
    const totalCost = initialCash - cash + positionsCost;
    const totalPnl = unrealizedPnl + realisedPnl;
    const totalReturnPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const dayPnlPct = positionsValue > 0 ? (dayPnl / positionsValue) * 100 : 0;

    const metrics: PerformanceMetrics = {
      totalValue,
      totalCost,
      unrealizedPnl,
      realizedPnl: realisedPnl,
      totalPnl,
      totalReturnPct,
      dayPnl,
      dayPnlPct,
      cash,
      positionsValue,
    };

    const tradePnlList: number[] = fills.map((f: PaperFillRow) => Number(f.realizedPnl));
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

    const trades: TradeStats = {
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

    const risk: RiskMetrics = {
      sharpeRatio: null,
      maxDrawdown: null,
      maxDrawdownPct: null,
      volatility: null,
      beta: null,
    };

    const history: PerformanceDataPoint[] = fills.length > 0
      ? [{
          date: new Date(fills[0].executedAt).toISOString().split("T")[0],
          value: cash + positionsValue,
          pnl: totalPnl,
        }]
      : [{ date: new Date().toISOString().split("T")[0], value: cash, pnl: 0 }];

    const hasData = orders.length > 0 || positions.length > 0 || fills.length > 0;

    return { metrics, risk, trades, history, hasData };
  }, [account, positions, orders, fills, quoteMap]);

  return analytics;
}
