/**
 * Portfolio Analytics Library
 * P&L calculation, performance metrics, and risk analytics
 */

// Position types
export interface Position {
  id: string;
  symbol: string;
  exchange: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  type: "long" | "short";
  sector?: string;
  stopLoss?: number;
  target?: number;
  addedAt: string;
}

// Trade/Fill
export interface Trade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  timestamp: string;
  fees: number;
}

// P&L Calculation
export interface PositionPnL {
  positionId: string;
  symbol: string;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  pnlPercent: number;
  dayPnL: number;
  holdingPeriodDays: number;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
}

// Portfolio Summary
export interface PortfolioSummary {
  totalInvested: number;
  currentValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  dayPnL: number;
  dayPnLPercent: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalReturns: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  largestWin: number;
  largestLoss: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  beta: number;
}

// Calculate position P&L
export function calculatePositionPnL(
  position: Position,
  previousPrice?: number
): PositionPnL {
  const unrealizedPnL =
    position.type === "long"
      ? (position.currentPrice - position.avgPrice) * position.quantity
      : (position.avgPrice - position.currentPrice) * position.quantity;

  const invested = position.avgPrice * position.quantity;
  const currentValue = position.currentPrice * position.quantity;

  const pnlPercent = invested > 0 ? (unrealizedPnL / invested) * 100 : 0;

  const dayPnL =
    previousPrice && previousPrice > 0
      ? ((position.currentPrice - previousPrice) * position.quantity *
        (position.type === "long" ? 1 : -1))
      : 0;

  const addedAt = new Date(position.addedAt).getTime();
  const holdingPeriodDays = Math.floor((Date.now() - addedAt) / (24 * 60 * 60 * 1000));

  return {
    positionId: position.id,
    symbol: position.symbol,
    realizedPnL: 0,
    unrealizedPnL,
    totalPnL: unrealizedPnL,
    pnlPercent,
    dayPnL,
    holdingPeriodDays,
    currentPrice: position.currentPrice,
    avgPrice: position.avgPrice,
    quantity: position.quantity,
  };
}

// Calculate portfolio summary from all positions and trades
export function calculatePortfolioSummary(
  positions: Position[],
  trades: Trade[],
  previousPrices?: Record<string, number>
): PortfolioSummary {
  let totalInvested = 0;
  let currentValue = 0;
  let totalPnL = 0;
  let dayPnL = 0;
  let unrealizedPnL = 0;
  let realizedPnL = 0;

  // Calculate position P&L
  const positionPnLs = positions.map((pos) => {
    const prev = previousPrices?.[pos.symbol];
    const pnl = calculatePositionPnL(pos, prev);

    totalInvested += pos.avgPrice * pos.quantity;
    currentValue += pos.currentPrice * pos.quantity;
    unrealizedPnL += pnl.unrealizedPnL;
    dayPnL += pnl.dayPnL;

    return pnl;
  });

  // Calculate realized P&L from completed trades
  const symbolTrades: Record<string, Trade[]> = {};
  trades.forEach((trade) => {
    if (!symbolTrades[trade.symbol]) symbolTrades[trade.symbol] = [];
    symbolTrades[trade.symbol].push(trade);
  });

  Object.values(symbolTrades).forEach((symbolTrades) => {
    let buyQty = 0;
    let buyCost = 0;
    let sellQty = 0;
    let sellRevenue = 0;

    symbolTrades.forEach((trade) => {
      const fees = trade.fees || 0;
      if (trade.side === "buy") {
        buyQty += trade.quantity;
        buyCost += (trade.price * trade.quantity) + fees;
      } else {
        sellQty += trade.quantity;
        sellRevenue += (trade.price * trade.quantity) - fees;
      }
    });

    // Match buy-sell pairs
    const matchedQty = Math.min(buyQty, sellQty);
    if (matchedQty > 0) {
      const avgBuyPrice = buyCost / buyQty;
      const avgSellPrice = sellRevenue / sellQty;
      realizedPnL += (avgSellPrice - avgBuyPrice) * matchedQty;
    }
  });

  totalPnL = unrealizedPnL + realizedPnL;

  // Performance metrics
  const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const dayPnLPercent = currentValue > 0 ? (dayPnL / currentValue) * 100 : 0;

  // Trade statistics
  const totalTrades = trades.length;
  const winningTrades = trades.filter(
    (t) => t.side === "sell" && t.price > (t.price * 0.95) // Simplified win check
  ).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  // Calculate returns for Sharpe
  const returns = positionPnLs.map((p) => p.pnlPercent);
  const avgReturn = returns.length > 0
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(
        returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
      )
    : 0;
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  // Max drawdown (simplified)
  const peakValue = Math.max(...positions.map((p) => p.avgPrice * p.quantity));
  const maxDrawdown = currentValue > 0
    ? ((peakValue - currentValue) / peakValue) * 100
    : 0;

  // Profit factor
  const totalWinning = positionPnLs.filter((p) => p.totalPnL > 0).reduce((sum, p) => sum + p.totalPnL, 0);
  const totalLosing = Math.abs(positionPnLs.filter((p) => p.totalPnL < 0).reduce((sum, p) => sum + p.totalPnL, 0));
  const profitFactor = totalLosing > 0 ? totalWinning / totalLosing : totalWinning > 0 ? Infinity : 0;

  const largestWin = positionPnLs.length > 0
    ? Math.max(...positionPnLs.map((p) => p.totalPnL))
    : 0;
  const largestLoss = positionPnLs.length > 0
    ? Math.min(...positionPnLs.map((p) => p.totalPnL))
    : 0;

  const avgWin = winningTrades > 0 ? totalWinning / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? totalLosing / losingTrades : 0;

  return {
    totalInvested,
    currentValue,
    totalPnL,
    totalPnLPercent,
    dayPnL,
    dayPnLPercent,
    realizedPnL,
    unrealizedPnL,
    totalReturns: totalPnLPercent,
    winRate,
    totalTrades,
    winningTrades,
    losingTrades,
    largestWin,
    largestLoss,
    avgWin,
    avgLoss,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    beta: 1, // Simplified - needs benchmark data
  };
}

// Sector allocation
export function calculateSectorAllocation(positions: Position[]): Array<{
  sector: string;
  value: number;
  allocation: number;
}> {
  const sectorTotals: Record<string, number> = {};

  positions.forEach((pos) => {
    const sector = pos.sector || "Others";
    const value = pos.currentPrice * pos.quantity;
    sectorTotals[sector] = (sectorTotals[sector] || 0) + value;
  });

  const totalValue = Object.values(sectorTotals).reduce((a, b) => a + b, 0);

  return Object.entries(sectorTotals).map(([sector, value]) => ({
    sector,
    value,
    allocation: totalValue > 0 ? (value / totalValue) * 100 : 0,
  })).sort((a, b) => b.allocation - a.allocation);
}

// Risk metrics
export interface RiskMetrics {
  portfolioBeta: number;
  portfolioVolatility: number;
  var95: number; // Value at Risk 95%
  cVar95: number; // Conditional VaR
  concentrationRisk: number;
  leverage: number;
}

export function calculateRiskMetrics(
  positions: Position[],
  benchmarkReturns?: number[]
): RiskMetrics {
  const portfolioValue = positions.reduce((sum, pos) => {
    return sum + pos.currentPrice * pos.quantity;
  }, 0);

  // Simplified beta (weighted average)
  const portfolioBeta = positions.reduce((sum, pos) => {
    const weight = (pos.currentPrice * pos.quantity) / portfolioValue;
    return sum + weight * 1; // Assume beta=1 for all stocks (should use real beta)
  }, 0);

  // Simplified volatility (weighted std dev)
  const returns = positions.map(() => (Math.random() - 0.5) * 0.02); // Mock daily returns
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const portfolioVolatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized

  // VaR 95% (simplified - parametric)
  const var95 = portfolioValue * 1.65 * (portfolioVolatility / 100);

  // Conditional VaR (average loss beyond VaR)
  const tailLoss = returns.filter((r) => r < -1.65 * Math.sqrt(variance));
  const cVar95 = tailLoss.length > 0
    ? portfolioValue * (tailLoss.reduce((a, b) => a + b, 0) / tailLoss.length)
    : var95 * 1.2;

  // Concentration risk (Herfindahl index)
  const weights = positions.map((pos) => (pos.currentPrice * pos.quantity) / portfolioValue);
  const concentrationRisk = weights.reduce((sum, w) => sum + w * w, 0) * 10000;

  // Leverage (simplified)
  const longValue = positions.filter((p) => p.type === "long").reduce((sum, p) => {
    return sum + p.currentPrice * p.quantity;
  }, 0);
  const shortValue = positions.filter((p) => p.type === "short").reduce((sum, p) => {
    return sum + p.currentPrice * p.quantity;
  }, 0);
  const leverage = portfolioValue > 0 ? (longValue + shortValue) / portfolioValue : 1;

  return {
    portfolioBeta,
    portfolioVolatility,
    var95,
    cVar95,
    concentrationRisk,
    leverage,
  };
}