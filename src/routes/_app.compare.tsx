import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketCandles } from "@/lib/market-api";

export const Route = createFileRoute("/_app/compare")({
  head: () => ({ meta: [{ title: "Compare — MAET" }] }),
  component: Compare,
});

const COLORS = ["#2962ff", "#26a69a", "#ef5350", "#f59e0b", "#8b5cf6"];

function Compare() {
  const [symbols, setSymbols] = useState(["RELIANCE", "TCS", "INFY"]);
  const [input, setInput] = useState("");
  const { quoteMap, isFetching, isError } = useMarketQuotes(symbols);
  const candleQueries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["compare-candles", symbol],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchMarketCandles(symbol, "1d", "3mo", signal),
      staleTime: 60_000,
      retry: 2,
    })),
  });

  const chartData = useMemo(() => {
    const series = candleQueries.map((query) => query.data?.candles ?? []);
    const maxLength = Math.max(0, ...series.map((candles) => candles.length));
    return Array.from({ length: maxLength }, (_, index) => {
      const row: Record<string, string | number> = { index };
      series.forEach((candles, seriesIndex) => {
        const offset = maxLength - candles.length;
        const candle = candles[index - offset];
        const first = candles[0]?.close;
        if (candle && first) {
          row[symbols[seriesIndex]] = ((candle.close - first) / first) * 100;
          row.date = new Date(candle.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        }
      });
      return row;
    });
  }, [candleQueries, symbols]);

  const addSymbol = () => {
    const normalized = input.trim().toUpperCase();
    if (normalized && !symbols.includes(normalized) && symbols.length < 5) {
      setSymbols((current) => [...current, normalized]);
      setInput("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <span className="mr-1 font-semibold">Compare</span>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
          Yahoo delayed
        </span>
        {symbols.map((symbol, index) => (
          <div key={symbol} className="flex items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS[index] }} />
            <span className="font-mono font-semibold">{symbol}</span>
            {symbols.length > 2 && (
              <button type="button" onClick={() => setSymbols((current) => current.filter((item) => item !== symbol))} aria-label={`Remove ${symbol}`}>
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        ))}
        <div className="ml-1 flex items-center rounded border border-border bg-background">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addSymbol()}
            placeholder="Add symbol"
            className="w-28 bg-transparent px-2 py-1.5 text-xs uppercase outline-none"
            aria-label="Symbol to compare"
          />
          <button type="button" onClick={addSymbol} className="border-l border-border p-1.5 text-muted-foreground hover:text-primary" aria-label="Add comparison symbol">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-[420px] flex-1 border-b border-border p-3">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 14, right: 28, bottom: 6, left: 4 }}>
              <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="date" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} minTickGap={34} />
              <YAxis
                stroke="var(--color-muted-foreground)"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                width={46}
              />
              <Tooltip
                contentStyle={{ background: "var(--color-panel-elevated)", border: "1px solid var(--color-border)", borderRadius: 4 }}
                formatter={(value) => [`${Number(value).toFixed(2)}%`, ""]}
              />
              <Legend />
              {symbols.map((symbol, index) => (
                <Line key={symbol} dataKey={symbol} stroke={COLORS[index]} dot={false} strokeWidth={1.7} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {isError ? "Market history is temporarily unavailable" : "Loading normalized performance…"}
          </div>
        )}
      </div>

      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Symbol</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
              <th className="px-4 py-2 text-right font-medium">Previous close</th>
              <th className="px-4 py-2 text-right font-medium">Cash volume</th>
              <th className="px-4 py-2 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => {
              const quote = quoteMap.get(symbol);
              return (
                <tr key={symbol} className="border-t border-border/70">
                  <td className="px-4 py-2 font-mono font-semibold text-primary">{symbol}</td>
                  <td className="px-4 py-2 text-right font-mono">{quote?.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                  <td className={`px-4 py-2 text-right font-mono ${(quote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                    {quote?.changePct === undefined ? "—" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{quote?.previousClose?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{quote?.volume.toLocaleString("en-IN") ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {quote?.ts ? new Date(quote.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>{isFetching ? "Refreshing market data…" : "Performance rebased to 0%"}</span>
        <span className={isError ? "text-bear" : "text-bull"}>{isError ? "Data unavailable" : "Market feed active"}</span>
      </div>
    </div>
  );
}
