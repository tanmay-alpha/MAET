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
  /** Executed share/contract quantity. */
  quantity?: number;
  /** Total traded notional value (sum of entry and exit notional). */
  notional?: number;
}

export const TRADING_DAYS_PER_YEAR = 252;
export const MINUTES_PER_SESSION = 375; // 9:15 AM to 3:30 PM IST = 6h 15m

/**
 * Returns the number of observation periods per year based on Indian equity market trading sessions:
 * - 252 trading sessions / year
 * - Regular equity trading hours: 9:15 AM to 3:30 PM = 375 minutes / session
 */
export function getPeriodsPerYear(timeframe?: string | number): number {
  if (typeof timeframe === "number") {
    // Backward compatibility for observationIntervalDays
    if (timeframe === 1) return TRADING_DAYS_PER_YEAR;
    if (timeframe > 0) return Math.round(TRADING_DAYS_PER_YEAR / timeframe);
    return TRADING_DAYS_PER_YEAR;
  }

  if (!timeframe) return TRADING_DAYS_PER_YEAR;

  const tf = timeframe.trim().toLowerCase();
  switch (tf) {
    case "1m":
      return TRADING_DAYS_PER_YEAR * MINUTES_PER_SESSION; // 94,500
    case "3m":
      return TRADING_DAYS_PER_YEAR * (MINUTES_PER_SESSION / 3); // 31,500
    case "5m":
      return TRADING_DAYS_PER_YEAR * (MINUTES_PER_SESSION / 5); // 18,900
    case "15m":
      return TRADING_DAYS_PER_YEAR * (MINUTES_PER_SESSION / 15); // 6,300
    case "30m":
      return TRADING_DAYS_PER_YEAR * (MINUTES_PER_SESSION / 30); // 3,150
    case "1h":
    case "60m":
      return TRADING_DAYS_PER_YEAR * (MINUTES_PER_SESSION / 60); // 1,575
    case "1d":
      return TRADING_DAYS_PER_YEAR; // 252
    case "1wk":
    case "1w":
      return 52;
    case "1mo":
    case "1m_month":
      return 12;
    default:
      return TRADING_DAYS_PER_YEAR;
  }
}

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
  timeframe: string | number = "1d",
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

  const totalBars = equityCurve.length - 1;
  const periodsPerYear = getPeriodsPerYear(timeframe);
  const years = periodsPerYear > 0 ? totalBars / periodsPerYear : 0;
  const annualisedReturn = years > 0 && totalReturn > -1
    ? (1 + totalReturn) ** (1 / years) - 1
    : (totalReturn <= -1 ? -1 : 0);

  const returns = computeReturns(equityValues);
  const vol = returns.length >= 2 ? stddev(returns) * Math.sqrt(periodsPerYear) : 0;
  const downside = returns.length >= 2 ? downsideDeviation(returns, 0) * Math.sqrt(periodsPerYear) : 0;
  const sharpe = vol > 0 ? annualisedReturn / vol : 0;
  const sortino = downside > 0 ? annualisedReturn / downside : 0;

  const mdd = computeMaxDrawdown(equityValues);
  const calmar = mdd > 0 ? annualisedReturn / mdd : 0;

  // Benchmark comparison
  let benchmarkReturn = 0;
  let benchmarkAnnualisedReturn = 0;
  let alpha = 0;
  if (benchmarkCurve && benchmarkCurve.length >= 2) {
    const bInit = benchmarkCurve[0].benchmark ?? benchmarkCurve[0].equity;
    const bFinal = benchmarkCurve[benchmarkCurve.length - 1].benchmark ?? benchmarkCurve[benchmarkCurve.length - 1].equity;
    if (bInit > 0) {
      benchmarkReturn = (bFinal - bInit) / bInit;
      const bBars = benchmarkCurve.length - 1;
      const bYears = periodsPerYear > 0 ? bBars / periodsPerYear : 0;
      benchmarkAnnualisedReturn = bYears > 0 && benchmarkReturn > -1
        ? (1 + benchmarkReturn) ** (1 / bYears) - 1
        : (benchmarkReturn <= -1 ? -1 : 0);
      alpha = annualisedReturn - benchmarkAnnualisedReturn;
    }
  }

  // Trade stats
  const wins = trades.filter((t) => (t.netPnl !== undefined ? t.netPnl : t.return) > 0);
  const losses = trades.filter((t) => (t.netPnl !== undefined ? t.netPnl : t.return) <= 0);
  const winRate = trades.length === 0 ? 0 : wins.length / trades.length;

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

  const totalDurationMs = equityCurve[equityCurve.length - 1].timestamp - equityCurve[0].timestamp;
  const totalDurationDays = totalDurationMs / 86_400_000;
  const averageHoldingPeriod = trades.length === 0 ? 0
    : (trades.reduce((s, t) => s + (t.exitTimestamp - t.entryTimestamp), 0) / trades.length) / 86_400_000;

  const totalHoldingMs = trades.reduce((s, t) => s + (t.exitTimestamp - t.entryTimestamp), 0);
  const exposure = totalDurationMs > 0 ? Math.min(1, totalHoldingMs / totalDurationMs) : 0;

  // Portfolio Turnover = total traded notional / average portfolio equity
  const avgEquity = equityValues.length > 0 ? mean(equityValues) : initial;
  const totalTradedNotional = trades.reduce((acc, t) => {
    if (t.notional !== undefined && t.notional > 0) return acc + t.notional;
    if (t.quantity !== undefined && t.quantity > 0) return acc + t.quantity * (t.entryPrice + t.exitPrice);
    return acc + (t.entryPrice + t.exitPrice);
  }, 0);
  const turnover = avgEquity > 0 && trades.length > 0 ? totalTradedNotional / avgEquity : 0;

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