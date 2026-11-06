/**
 * JSON shapes of the strategy backtest tables as the strategyBacktests procedures return them
 * (server/db/schema.ts). Postgres numeric columns arrive as strings, nullable where the column is.
 */

type Numeric = string | null;

export interface PerformanceSnapshotRow {
  id: string;
  jobId: string;
  symbolOrUniverse: string;
  timeframe: string;
  totalReturn: Numeric;
  annualizedReturn: Numeric;
  maxDrawdown: Numeric;
  sharpe: Numeric;
  sortino: Numeric;
  calmar: Numeric;
  winRate: Numeric;
  profitFactor: Numeric;
  /** Average net P&L per trade in rupees. */
  expectancy: Numeric;
  tradeCount: number | null;
  longTradeCount: number | null;
  shortTradeCount: number | null;
  feesPaid: Numeric;
  slippageCost: Numeric;
  netProfit: Numeric;
  dataHash: string | null;
  engineVersion: string | null;
  executionPolicy: string | null;
  intrabarPolicy: string | null;
}

export interface BacktestTradeRow {
  id: string;
  direction: string;
  entryFillTimestamp: string | null;
  entryPrice: string;
  entryQuantity: string;
  exitFillTimestamp: string | null;
  exitPrice: Numeric;
  netPnl: Numeric;
  /** Already in percent (1.25 = 1.25%). */
  returnPercent: Numeric;
  holdingBars: number | null;
  exitReason: string | null;
}

export interface EquityPointRow {
  timestamp: string;
  equity: string;
}
