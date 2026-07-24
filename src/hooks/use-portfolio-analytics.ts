/**
 * Portfolio Analytics Hook
 * Real-time performance metrics, P&L calculations, and risk analytics
 * Updated for v3 domain: uses fills, quantity, averagePrice, realisedPnl
 */

import { useMemo } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useMarketQuotes } from "@/hooks/use-market-quotes";

// Types
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
  const { account } = usePaperAccount();

  // Get unique symbols from positions
  const positionSymbols = useMemo(
    () => [...new Set(account.positions.map((p) => p.symbol))],
    [account.positions]
  );

  const { quoteMap } = useMarketQuotes(positionSymbols);

  const analytics = useMemo<PortfolioAnalytics>(() => {
    // Use fills for trade statistics instead of orders
    const fills = account.fills ?? [];

    // Calculate positions metrics
    let unrealizedPnl = 0;
    let positionsValue = 0;
    let positionsCost = 0;
    let dayPnl = 0;

    account.positions.forEach((position) => {
      const quote = quoteMap.get(position.symbol);
      if (quote && (!Number.isFinite(quote.price) || quote.price <= 0)) {
        return; // Skip positions with invalid quote data
      }
      const currentPrice = quote?.price || position.averagePrice;
      const prevPrice = quote?.previousClose;

      if (!Number.isFinite(currentPrice) || !Number.isFinite(position.averagePrice)) {
        return; // Skip if price data is not finite
      }

      const absQty = Math.abs(position.quantity);
      positionsValue += currentPrice * absQty;
      positionsCost += position.averagePrice * absQty;
      unrealizedPnl += (currentPrice - position.averagePrice) * position.quantity;

      if (prevPrice && prevPrice > 0 && Number.isFinite(prevPrice)) {
        dayPnl += (currentPrice - prevPrice) * position.quantity;
      }
    });

    const totalValue = account.cash + positionsValue;
    const totalCost = account.initialCash - account.cash + positionsCost;
    const realisedPnl = account.realisedPnl;
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
      cash: account.cash,
      positionsValue,
    };

    // Calculate trade statistics from fills
    const tradePnlList: number[] = fills.map((f) => f.realisedPnl);
    const tradeDates: string[] = fills.map((f) => f.executedAt);
    void tradeDates; // used for potential future holding-period computation

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

    const avgHoldingDays = 0; // Would need entry/exit tracking across fills

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
      avgHoldingDays,
    };

    // Risk metrics require a verified daily portfolio return series.
    // Paper fills alone are not sufficient — leave as null.
    const risk: RiskMetrics = {
      sharpeRatio: null,
      maxDrawdown: null,
      maxDrawdownPct: null,
      volatility: null,
      beta: null,
    };

    // Simple equity curve from fills
    const history: PerformanceDataPoint[] = fills.length > 0
      ? [{
          date: fills[fills.length - 1].executedAt.split("T")[0],
          value: account.cash + positionsValue,
          pnl: totalPnl,
        }]
      : [{ date: new Date().toISOString().split("T")[0], value: account.cash, pnl: 0 }];

    const hasData = account.orders.length > 0 || account.positions.length > 0;

    return { metrics, risk, trades, history, hasData };
  }, [account, quoteMap]);

  return analytics;
}
