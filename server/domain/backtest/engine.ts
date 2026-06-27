import type { Candle } from "@shared/types";
import type { Signal, Strategy } from "./strategies";

export type BacktestTrade = {
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  returnPct: number;
};

export type EquityPoint = { ts: string; value: number };

export type BacktestResult = {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRatePct: number;
  profitFactor: number | null;
  avgTradePnl: number;
  trades: BacktestTrade[];
  equity: EquityPoint[];
  monthlyReturns: Array<{ month: string; returnPct: number }>;
};

export type BacktestOptions = {
  initialCapital?: number;
  feeBps?: number;
  periodsPerYear?: number;
};

function monthlyReturns(equity: EquityPoint[]): Array<{ month: string; returnPct: number }> {
  const months = new Map<string, { first: number; last: number }>();
  for (const point of equity) {
    const month = point.ts.slice(0, 7);
    const current = months.get(month);
    if (current) current.last = point.value;
    else months.set(month, { first: point.value, last: point.value });
  }
  return [...months.entries()].map(([month, values]) => ({
    month,
    returnPct: values.first > 0 ? ((values.last - values.first) / values.first) * 100 : 0,
  }));
}

export function runBacktest(
  candles: Candle[],
  strategy: Strategy,
  options: BacktestOptions = {}
): BacktestResult {
  if (candles.length < 2) throw new Error("At least two candles are required");
  const initialCapital = options.initialCapital ?? 1_000_000;
  const feeRate = (options.feeBps ?? 5) / 10_000;
  const periodsPerYear = options.periodsPerYear ?? 252;
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error("Invalid initial capital");

  const ordered = [...candles].sort((a, b) => a.ts.localeCompare(b.ts));
  const signalByTs = new Map<string, Signal[]>();
  for (const signal of strategy.signals(ordered)) {
    const list = signalByTs.get(signal.ts) ?? [];
    list.push(signal);
    signalByTs.set(signal.ts, list);
  }

  let cash = initialCapital;
  let qty = 0;
  let entryPrice = 0;
  let entryTs = "";
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [];

  const closePosition = (candle: Candle) => {
    if (qty === 0) return;
    const proceeds = qty * candle.close;
    const exitFee = proceeds * feeRate;
    cash += proceeds - exitFee;
    const entryCost = qty * entryPrice;
    const entryFee = entryCost * feeRate;
    const pnl = proceeds - exitFee - entryCost - entryFee;
    trades.push({
      entryTs,
      exitTs: candle.ts,
      entryPrice,
      exitPrice: candle.close,
      qty,
      pnl,
      returnPct: entryCost > 0 ? (pnl / entryCost) * 100 : 0,
    });
    qty = 0;
    entryPrice = 0;
    entryTs = "";
  };

  for (const candle of ordered) {
    for (const signal of signalByTs.get(candle.ts) ?? []) {
      if (signal.side === "BUY" && qty === 0) {
        const perShare = candle.close * (1 + feeRate);
        const nextQty = Math.floor(cash / perShare);
        if (nextQty > 0) {
          qty = nextQty;
          entryPrice = candle.close;
          entryTs = candle.ts;
          cash -= qty * candle.close * (1 + feeRate);
        }
      } else if (signal.side === "SELL") {
        closePosition(candle);
      }
    }
    equity.push({ ts: candle.ts, value: cash + qty * candle.close });
  }

  if (qty > 0) {
    closePosition(ordered[ordered.length - 1]);
    equity[equity.length - 1] = { ts: ordered[ordered.length - 1].ts, value: cash };
  }

  const finalEquity = equity[equity.length - 1].value;
  let peak = equity[0].value;
  let maxDrawdownPct = 0;
  const returns: number[] = [];
  for (let index = 0; index < equity.length; index++) {
    peak = Math.max(peak, equity[index].value);
    const drawdown = peak > 0 ? ((equity[index].value - peak) / peak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdown);
    if (index > 0 && equity[index - 1].value > 0) {
      returns.push((equity[index].value - equity[index - 1].value) / equity[index - 1].value);
    }
  }
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const deviation = Math.sqrt(variance);
  const sharpe = deviation > 0 ? (mean / deviation) * Math.sqrt(periodsPerYear) : 0;
  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));

  return {
    initialCapital,
    finalEquity,
    totalReturnPct: ((finalEquity - initialCapital) / initialCapital) * 100,
    maxDrawdownPct,
    sharpe,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    avgTradePnl: trades.length ? trades.reduce((sum, trade) => sum + trade.pnl, 0) / trades.length : 0,
    trades,
    equity,
    monthlyReturns: monthlyReturns(equity),
  };
}
