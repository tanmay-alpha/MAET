import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/backtest")({
  head: () => ({ meta: [{ title: "Backtest Lab V2 — MAET" }] }),
  component: Backtest,
});

function Curve({ data }: { data: Array<{ timestamp: number; equity: number }> }) {
  const gradientId = useId().replace(/:/g, "");
  if (!data || data.length < 2) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No equity curve available</div>;
  const min = Math.min(...data.map((point) => point.equity));
  const max = Math.max(...data.map((point) => point.equity));
  const spread = max - min || 1;
  const points = data.map((point, index) => `${(index / (data.length - 1)) * 100},${100 - ((point.equity - min) / spread) * 100}`).join(" ");
  const profitable = data[data.length - 1].equity >= data[0].equity;
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
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("RELIANCE");
  const [strategy, setStrategy] = useState("SMA_CROSS");
  const [timeframe, setTimeframe] = useState("1d");
  const [fast, setFast] = useState(20);
  const [slow, setSlow] = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14);

  const runsQuery = useQuery({
    queryKey: ["backtestV2", "listRuns"],
    queryFn: () => trpc.backtestV2.listRuns.query(),
  });

  const mutation = useMutation({
    mutationFn: (input: any) => trpc.backtestV2.run.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtestV2"] });
    },
  });

  const result = mutation.data?.result;

  const run = () => mutation.mutate({
    symbol,
    timeframe,
    strategy: {
      type: strategy,
      fastPeriod: fast,
      slowPeriod: slow,
      rsiPeriod,
    },
    risk: {
      initialCapital: 100000,
      feeBps: 10,
      slippageBps: 5,
      positionSizePercent: 100,
      maximumOpenPositions: 1,
    },
  });

  const metrics = result ? [
    { label: "Total Return", value: `${((result.metrics?.totalReturn ?? 0) * 100).toFixed(2)}%`, trend: result.metrics?.totalReturn ?? 0 },
    { label: "Sharpe Ratio", value: (result.metrics?.sharpe ?? 0).toFixed(2), trend: result.metrics?.sharpe ?? 0 },
    { label: "Sortino Ratio", value: (result.metrics?.sortino ?? 0).toFixed(2), trend: result.metrics?.sortino ?? 0 },
    { label: "Max Drawdown", value: `${((result.metrics?.maxDrawdown ?? 0) * 100).toFixed(2)}%`, trend: result.metrics?.maxDrawdown ?? 0 },
    { label: "Win Rate", value: `${((result.metrics?.winRate ?? 0) * 100).toFixed(1)}%`, trend: (result.metrics?.winRate ?? 0) - 0.5 },
    { label: "Trades Executed", value: String(result.signalCount ?? 0), trend: 0 },
  ] : [];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Backtest Lab V2</h1>
          <p className="text-xs text-muted-foreground">Next-bar execution · zero lookahead bias · persisted runs</p>
        </div>
        <button type="button" onClick={run} disabled={mutation.isPending} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {mutation.isPending ? "Running…" : "Run Backtest V2"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</span>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" />
        </label>
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy</span>
          <select value={strategy} onChange={(event) => setStrategy(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option value="SMA_CROSS">SMA Cross</option>
            <option value="EMA_CROSS">EMA Cross</option>
            <option value="RSI_REVERSAL">RSI Reversal</option>
            <option value="MACD_CROSS">MACD Cross</option>
            <option value="DONCHIAN_BREAKOUT">Donchian Breakout</option>
            <option value="BOLLINGER_MEAN_REVERSION">Bollinger Mean Reversion</option>
          </select>
        </label>
        <label className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeframe</span>
          <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option value="1d">Daily</option>
          </select>
        </label>
        {strategy === "SMA_CROSS" || strategy === "EMA_CROSS" ? <>
          <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fast Period</span><input type="number" min={2} value={fast} onChange={(event) => setFast(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>
          <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Slow Period</span><input type="number" min={3} value={slow} onChange={(event) => setSlow(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>
        </> : <label className="rounded-lg border border-border bg-panel p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">RSI Period</span><input type="number" min={2} value={rsiPeriod} onChange={(event) => setRsiPeriod(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-medium outline-none" /></label>}
      </div>

      {mutation.isError && <div className="rounded-lg border border-bear/40 bg-bear/10 p-3 text-sm text-bear">{mutation.error.message}</div>}

      {!result && !mutation.isPending && !mutation.isError && (
        <div className="rounded-lg border border-border bg-panel px-4 py-16 text-center text-sm text-muted-foreground">Choose a symbol and strategy to run a V2 backtest.</div>
      )}

      {result && <>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm"><span className="font-medium">Equity Curve</span><span className="text-xs text-muted-foreground">{result.equityCurve?.length ?? 0} points · {result.symbol}</span></div>
            <div className="h-80 p-2"><Curve data={result.equityCurve ?? []} /></div>
          </div>
          <div className="rounded-lg border border-border bg-panel">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Performance Metrics</div>
            <div className="divide-y divide-border">
              {metrics.map((metric) => <div key={metric.label} className="flex items-center justify-between px-4 py-2.5 text-xs"><span className="text-muted-foreground">{metric.label}</span><span className={`font-mono font-semibold ${metric.trend > 0 ? "text-bull" : metric.trend < 0 ? "text-bear" : ""}`}>{metric.value}</span></div>)}
            </div>
          </div>
        </div>
      </>}

      {/* Persisted Runs */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Persisted Run History</h3>
        <div className="space-y-3">
          {runsQuery.data?.runs?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past backtest runs found.</p>
          ) : (
            runsQuery.data?.runs?.map((runItem: any) => (
              <div key={runItem.id} className="flex items-center justify-between border-b pb-3 text-xs">
                <div>
                  <span className="font-mono font-semibold">{runItem.symbol}</span>
                  <span className="ml-2 text-muted-foreground">({runItem.strategy} • {runItem.timeframe})</span>
                  <p className="text-muted-foreground text-[10px]">{new Date(runItem.createdAt).toLocaleString()}</p>
                </div>
                <span className="font-mono text-xs">ID: {runItem.id.slice(0, 8)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
