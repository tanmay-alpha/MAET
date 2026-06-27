import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
  runMarketBacktest,
  type BacktestRequest,
  type BacktestResponse,
} from "@/lib/market-api";

export const Route = createFileRoute("/_app/backtest")({
  head: () => ({ meta: [{ title: "Backtest — MAET" }] }),
  component: Backtest,
});

function Curve({ data }: { data: BacktestResponse["equity"] }) {
  const gradientId = useId().replace(/:/g, "");
  if (data.length < 2) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No equity curve available</div>;
  const min = Math.min(...data.map((point) => point.value));
  const max = Math.max(...data.map((point) => point.value));
  const spread = max - min || 1;
  const points = data.map((point, index) => `${(index / (data.length - 1)) * 100},${100 - ((point.value - min) / spread) * 100}`).join(" ");
  const profitable = data[data.length - 1].value >= data[0].value;
  const color = profitable ? "var(--color-bull)" : "var(--color-bear)";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }).map((_, index) => (
        <line key={index} x1="0" x2="100" y1={(index / 4) * 100} y2={(index / 4) * 100} stroke="var(--color-grid)" strokeWidth="0.1" />
      ))}
      <polyline points={`0,100 ${points} 100,100`} fill={`url(#${gradientId})`} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="0.5" />
    </svg>
  );
}

function Backtest() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [strategy, setStrategy] = useState<BacktestRequest["strategy"]>("sma_cross");
  const [timeframe, setTimeframe] = useState<BacktestRequest["timeframe"]>("1d");
  const [range, setRange] = useState<BacktestRequest["range"]>("2y");
  const [fast, setFast] = useState(20);
  const [slow, setSlow] = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const mutation = useMutation({ mutationFn: (input: BacktestRequest) => runMarketBacktest(input) });
  const result = mutation.data;

  const run = () => mutation.mutate({
    symbol,
    timeframe,
    range,
    strategy,
    initialCapital: 1_000_000,
    feeBps: 5,
    params: strategy === "sma_cross"
      ? { fast, slow }
      : { period: rsiPeriod, oversold: 30, overbought: 70 },
  });

  const metrics = result ? [
    { label: "Total return", value: `${result.totalReturnPct >= 0 ? "+" : ""}${result.totalReturnPct.toFixed(2)}%`, trend: result.totalReturnPct },
    { label: "Final equity", value: `₹${result.finalEquity.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, trend: result.finalEquity - result.initialCapital },
    { label: "Sharpe ratio", value: result.sharpe.toFixed(2), trend: result.sharpe },
    { label: "Max drawdown", value: `${result.maxDrawdownPct.toFixed(2)}%`, trend: result.maxDrawdownPct },
    { label: "Win rate", value: `${result.winRatePct.toFixed(1)}%`, trend: result.winRatePct - 50 },
    { label: "Profit factor", value: result.profitFactor === null ? "∞" : result.profitFactor.toFixed(2), trend: (result.profitFactor ?? 2) - 1 },
    { label: "Avg trade", value: `₹${result.avgTradePnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, trend: result.avgTradePnl },
    { label: "Trades", value: String(result.trades.length), trend: 0 },
  ] : [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Historical backtest</h1>
          <p className="text-xs text-muted-foreground">Real Yahoo candles · long-only · 5 bps fee per side · no slippage</p>
        </div>
        <button type="button" onClick={run} disabled={mutation.isPending} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {mutation.isPending ? "Running…" : "Run backtest"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</span>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" />
        </label>
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy</span>
          <select value={strategy} onChange={(event) => setStrategy(event.target.value as BacktestRequest["strategy"])} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option value="sma_cross">SMA cross</option><option value="rsi">RSI reversal</option>
          </select>
        </label>
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeframe</span>
          <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as BacktestRequest["timeframe"])} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option value="5m">5 minute</option><option value="15m">15 minute</option><option value="1h">1 hour</option><option value="1d">Daily</option><option value="1wk">Weekly</option>
          </select>
        </label>
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">History</span>
          <select value={range} onChange={(event) => setRange(event.target.value as BacktestRequest["range"])} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option value="5d">5 days</option><option value="1mo">1 month</option><option value="3mo">3 months</option><option value="1y">1 year</option><option value="2y">2 years</option><option value="5y">5 years</option>
          </select>
        </label>
        {strategy === "sma_cross" ? <>
          <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fast SMA</span><input type="number" min={2} value={fast} onChange={(event) => setFast(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>
          <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Slow SMA</span><input type="number" min={3} value={slow} onChange={(event) => setSlow(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>
        </> : <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">RSI period</span><input type="number" min={2} value={rsiPeriod} onChange={(event) => setRsiPeriod(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>}
      </div>

      {mutation.isError && <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 p-3 text-sm text-bear">{mutation.error.message}</div>}

      {!result && !mutation.isPending && !mutation.isError && (
        <div className="mt-4 rounded-lg border border-border bg-panel px-4 py-20 text-center text-sm text-muted-foreground">Choose a symbol and run a backtest. No sample result is shown.</div>
      )}

      {result && <>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm"><span className="font-medium">Equity curve</span><span className="text-xs text-muted-foreground">{result.candleCount} candles · {result.symbol}</span></div>
            <div className="h-80 p-2"><Curve data={result.equity} /></div>
          </div>
          <div className="rounded-lg border border-border bg-panel">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Calculated performance</div>
            <div className="divide-y divide-border">
              {metrics.map((metric) => <div key={metric.label} className="flex items-center justify-between px-4 py-2.5 text-xs"><span className="text-muted-foreground">{metric.label}</span><span className={`font-mono font-semibold tabular ${metric.trend > 0 ? "text-bull" : metric.trend < 0 ? "text-bear" : ""}`}>{metric.value}</span></div>)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-panel">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Monthly returns</div>
            <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
              {result.monthlyReturns.map((month) => <div key={month.month} className={`rounded border border-border px-3 py-2 ${month.returnPct >= 0 ? "bg-bull/10" : "bg-bear/10"}`}><div className="text-[10px] text-muted-foreground">{month.month}</div><div className={`font-mono text-xs tabular ${month.returnPct >= 0 ? "text-bull" : "text-bear"}`}>{month.returnPct >= 0 ? "+" : ""}{month.returnPct.toFixed(2)}%</div></div>)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-panel">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Closed trades</div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs"><thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">Entry</th><th className="text-left">Exit</th><th className="text-right">Qty</th><th className="px-3 text-right">P&amp;L</th></tr></thead><tbody>
                {result.trades.map((trade) => <tr key={`${trade.entryTs}-${trade.exitTs}`} className="border-t border-border"><td className="px-3 py-2 font-mono">{trade.entryTs.slice(0, 10)}</td><td className="font-mono">{trade.exitTs.slice(0, 10)}</td><td className="text-right font-mono">{trade.qty}</td><td className={`px-3 text-right font-mono ${trade.pnl >= 0 ? "text-bull" : "text-bear"}`}>{trade.pnl >= 0 ? "+" : ""}₹{trade.pnl.toFixed(2)}</td></tr>)}
                {result.trades.length === 0 && <tr className="border-t border-border"><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No signals were produced for this period.</td></tr>}
              </tbody></table>
            </div>
          </div>
        </div>
      </>}
    </div>
  );
}
