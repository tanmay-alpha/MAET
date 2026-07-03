/**
 * Portfolio Analytics Hook
 * Real-time performance metrics, P&L calculations, and risk analytics
 */

import { useMemo } from "react";
import { usePaperAccount, type PaperOrder } from "@/hooks/use-paper-account";
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

// Constants
// Build a minimal equity history from verified paper fills.
function generateEquityCurve(
  orders: PaperOrder[],
  initialCash: number
): PerformanceDataPoint[] {
  const filledOrders = orders
    .filter((order): order is PaperOrder & { filledAt: string; fillPrice: number } =>
      order.status === "filled" && order.filledAt !== undefined && order.fillPrice !== undefined
    )
    .sort((a, b) => new Date(a.filledAt!).getTime() - new Date(b.filledAt!).getTime());

  if (filledOrders.length === 0) {
    // Return initial value as single point
    return [{ date: new Date().toISOString().split("T")[0], value: initialCash, pnl: 0 }];
  }

  const points: PerformanceDataPoint[] = [];
  let runningCash = initialCash;
  const holdings: Map<string, { qty: number; avgPrice: number }> = new Map();

  filledOrders.forEach((order) => {
    const date = order.filledAt!.split("T")[0];

    if (order.side === "BUY") {
      runningCash -= order.fillPrice * order.qty;
      const existing = holdings.get(order.symbol);
      if (existing) {
        const totalQty = existing.qty + order.qty;
        const totalCost = existing.avgPrice * existing.qty + order.fillPrice * order.qty;
        holdings.set(order.symbol, { qty: totalQty, avgPrice: totalCost / totalQty });
      } else {
        holdings.set(order.symbol, { qty: order.qty, avgPrice: order.fillPrice });
      }
    } else {
      runningCash += order.fillPrice * order.qty;
      const existing = holdings.get(order.symbol);
      if (existing) {
        existing.qty -= order.qty;
        if (existing.qty <= 0) holdings.delete(order.symbol);
      }
    }
  });

  // Simplified: just return the cash position
  points.push({
    date: new Date().toISOString().split("T")[0],
    value: runningCash,
    pnl: runningCash - initialCash,
  });

  return points;
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
    const filledOrders = account.orders.filter((o) => o.status === "filled");

    // Calculate positions metrics
    let unrealizedPnl = 0;
    let positionsValue = 0;
    let positionsCost = 0;
    let dayPnl = 0;

    account.positions.forEach((position) => {
      const quote = quoteMap.get(position.symbol);
      const currentPrice = quote?.price || position.avgPrice;
      const prevPrice = quote?.previousClose;

      positionsValue += currentPrice * position.qty;
      positionsCost += position.avgPrice * position.qty;
      unrealizedPnl += (currentPrice - position.avgPrice) * position.qty;

      if (prevPrice && prevPrice > 0) {
        dayPnl += (currentPrice - prevPrice) * position.qty;
      }
    });

    const totalValue = account.cash + positionsValue;
    const totalCost = account.initialCash - account.cash + positionsCost;
    const totalPnl = unrealizedPnl + account.realizedPnl;
    const totalReturnPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const dayPnlPct = positionsValue > 0 ? (dayPnl / positionsValue) * 100 : 0;

    const metrics: PerformanceMetrics = {
      totalValue,
      totalCost,
      unrealizedPnl,
      realizedPnl: account.realizedPnl,
      totalPnl,
      totalReturnPct,
      dayPnl,
      dayPnlPct,
      cash: account.cash,
      positionsValue,
    };

    // Calculate trade statistics
    const tradePnlList: number[] = [];
    const tradeDates: string[] = [];

    // Group orders by symbol to calculate individual trade P&L
    const symbolOrders: Map<string, typeof filledOrders> = new Map();
    filledOrders.forEach((order) => {
      const existing = symbolOrders.get(order.symbol) || [];
      existing.push(order);
      symbolOrders.set(order.symbol, existing);
    });

    symbolOrders.forEach((orders) => {
      // Calculate FIFO P&L for each symbol
      let buyQty = 0;
      let buyCost = 0;

      orders.forEach((order) => {
        if (order.side === "BUY") {
          buyQty += order.qty;
          buyCost += order.fillPrice! * order.qty;
        } else {
          // Close positions
          let remainingQty = order.qty;
          const sellValue = order.fillPrice! * order.qty;

          while (remainingQty > 0 && buyQty > 0) {
            const closeQty = Math.min(remainingQty, buyQty);
            const avgBuyPrice = buyCost / buyQty;
            const tradePnl = (order.fillPrice! - avgBuyPrice) * closeQty;
            tradePnlList.push(tradePnl);

            buyQty -= closeQty;
            buyCost = buyQty > 0 ? (buyCost / (buyQty + closeQty)) * buyQty : 0;
            remainingQty -= closeQty;
          }
        }
        if (order.filledAt) {
          tradeDates.push(order.filledAt);
        }
      });
    });

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

    // Calculate average holding days
    const avgHoldingDays = filledOrders.length > 0 ? 0 : 0; // Would need entry/exit tracking

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

    // Risk metrics require a verified daily portfolio return series and a
    // benchmark series. Paper fills alone are not sufficient evidence.
    const risk: RiskMetrics = {
      sharpeRatio: null,
      maxDrawdown: null,
      maxDrawdownPct: null,
      volatility: null,
      beta: null,
    };

    // Generate equity curve
    const history = generateEquityCurve(account.orders, account.initialCash);

    const hasData = account.orders.length > 0 || account.positions.length > 0;

    return { metrics, risk, trades, history, hasData };
  }, [account, quoteMap]);

  return analytics;
}
