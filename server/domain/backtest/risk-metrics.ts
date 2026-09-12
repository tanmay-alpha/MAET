/**
 * Backtest V2 risk-aware metrics.
 *
 * All formulas use verified daily price history. Never synthesize values.
 */

export interface BacktestMetrics {
  totalReturn: number;
  annualisedReturn: number;
  benchmarkReturn: number;
  alpha: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  averageHoldingPeriod: number;
  exposure: number;
  turnover: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  benchmark?: number;
}

export interface TradeRecord {
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  side: "long" | "short";
  return: number;
  /** Net monetary P&L for this trade (after fees and slippage). Used for profit factor
   *  and expectancy when available — more accurate than percentage-based sums for
   *  heterogeneous position sizes. */
  netPnl?: number;
}

const TRADING_DAYS_PER_YEAR = 252;

export function computeReturns(points: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    if (prev === 0) {
      returns.push(0);
      continue;
    }
    returns.push((points[i] - prev) / prev);
  }
  return returns;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function downsideDeviation(returns: number[], target = 0): number {
  const downside = returns.filter((r) => r < target);
  if (downside.length === 0) return 0;
  const sumSq = downside.reduce((s, r) => s + r ** 2, 0);
  return Math.sqrt(sumSq / downside.length);
}

export function computeMaxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: TradeRecord[],
  benchmarkCurve?: EquityPoint[],
  /** Days per observation period. Default 1 (daily). Use 1/252 for minute bars, etc.
   *  Required for correct annualization when backtesting intraday timeframes. */
  observationIntervalDays = 1,
): BacktestMetrics {
  const empty: BacktestMetrics = {
    totalReturn: 0, annualisedReturn: 0, benchmarkReturn: 0, alpha: 0,
    volatility: 0, sharpe: 0, sortino: 0, maxDrawdown: 0, calmar: 0,
    winRate: 0, profitFactor: 0, expectancy: 0, averageHoldingPeriod: 0,
    exposure: 0, turnover: 0,
  };

  if (equityCurve.length < 2) return empty;

  const equityValues = equityCurve.map((p) => p.equity);
  const initial = equityValues[0];
  const final = equityValues[equityValues.length - 1];
  if (initial <= 0) return empty;
  const totalReturn = (final - initial) / initial;

  const days = (equityCurve[equityCurve.length - 1].timestamp - equityCurve[0].timestamp) / 86_400_000;
  const years = days / 365;
  const annualisedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0;

  const returns = computeReturns(equityValues);
  // P0-D fix: annualize using the actual observation interval, not always sqrt(252).
  // periodsPerYear = 1 / observationIntervalDays for a 365-day year.
  const periodsPerYear = 1 / (observationIntervalDays / 365);
  const vol = stddev(returns) * Math.sqrt(periodsPerYear);
  const downside = downsideDeviation(returns) * Math.sqrt(periodsPerYear);
  const sharpe = vol === 0 ? 0 : (annualisedReturn / vol);
  const sortino = downside === 0 ? 0 : annualisedReturn / downside;

  const mdd = computeMaxDrawdown(equityValues);
  const calmar = mdd === 0 ? 0 : annualisedReturn / mdd;

  // Benchmark comparison
  let benchmarkReturn = 0;
  let benchmarkAnnualisedReturn = 0;
  let alpha = 0;
  if (benchmarkCurve && benchmarkCurve.length >= 2) {
    const bInit = benchmarkCurve[0].benchmark ?? benchmarkCurve[0].equity;
    const bFinal = benchmarkCurve[benchmarkCurve.length - 1].benchmark ?? benchmarkCurve[benchmarkCurve.length - 1].equity;
    if (bInit > 0) {
      benchmarkReturn = (bFinal - bInit) / bInit;
      // P0-D fix: annualize benchmark return using the same period as the strategy
      // so alpha is dimensionally consistent (annualized - annualized).
      // Previously alpha = annualisedReturn - totalBenchmarkReturn (wrong!).
      const bDays = (benchmarkCurve[benchmarkCurve.length - 1].timestamp - benchmarkCurve[0].timestamp) / 86_400_000;
      const bYears = bDays / 365;
      benchmarkAnnualisedReturn = bYears > 0 ? (1 + benchmarkReturn) ** (1 / bYears) - 1 : 0;
      alpha = annualisedReturn - benchmarkAnnualisedReturn;
    }
  }

  // Trade stats
  const wins = trades.filter((t) => (t.netPnl !== undefined ? t.netPnl : t.return) > 0);
  const losses = trades.filter((t) => (t.netPnl !== undefined ? t.netPnl : t.return) <= 0);
  const winRate = trades.length === 0 ? 0 : wins.length / trades.length;

  // P0-D fix: profit factor uses monetary P&L when available, not percentage returns.
  // Percentage-based profit factor is wrong when position sizes differ across trades.
  const hasPnl = trades.length > 0 && trades[0].netPnl !== undefined;
  const grossProfit = hasPnl
    ? wins.reduce((s, t) => s + (t.netPnl ?? 0), 0)
    : wins.reduce((s, t) => s + t.return, 0);
  const grossLoss = hasPnl
    ? Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0))
    : Math.abs(losses.reduce((s, t) => s + t.return, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const expectancy = trades.length === 0 ? 0
    : hasPnl
      ? trades.reduce((s, t) => s + (t.netPnl ?? 0), 0) / trades.length
      : trades.reduce((s, t) => s + t.return, 0) / trades.length;
  const averageHoldingPeriod = trades.length === 0 ? 0 : trades.reduce((s, t) => s + (t.exitTimestamp - t.entryTimestamp), 0) / trades.length / 86_400_000;
  const exposure = trades.length === 0 ? 0 : Math.min(1, (trades.reduce((s, t) => s + (t.exitTimestamp - t.entryTimestamp), 0) / 86_400_000) / Math.max(1, days));
  const turnover = trades.length === 0 ? 0 : trades.length / Math.max(1, days / 365);

  return {
    totalReturn,
    annualisedReturn,
    benchmarkReturn,
    alpha,
    volatility: vol,
    sharpe,
    sortino,
    maxDrawdown: mdd,
    calmar,
    winRate,
    profitFactor,
    expectancy,
    averageHoldingPeriod,
    exposure,
    turnover,
  };
}