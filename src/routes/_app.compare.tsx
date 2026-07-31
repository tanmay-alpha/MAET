import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
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
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/compare")({
  head: () => ({ meta: [{ title: "Compare — MAET" }] }),
  component: Compare,
});

const COLORS = ["#2962ff", "#26a69a", "#ef5350", "#f59e0b", "#8b5cf6"];

type TabType = "Performance" | "Valuation" | "Growth" | "Profitability" | "Leverage" | "Momentum";

function Compare() {
  const [symbols, setSymbols] = useState(["RELIANCE", "TCS", "INFY"]);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("Performance");
  const primarySymbol = symbols[0] || "RELIANCE";

  const { quoteMap, isFetching, isError } = useMarketQuotes(symbols);

  const peerQuery = useQuery({
    queryKey: ["peerComparison", primarySymbol],
    queryFn: () => trpc.companies.getPeerComparison.query({ symbol: primarySymbol }),
  });

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

  const peerData = peerQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <span className="mr-1 font-semibold">Compare</span>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
          Verified Sector
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

      {/* Tabs */}
      <div className="flex border-b border-border bg-panel px-4 text-xs font-medium">
        {(["Performance", "Valuation", "Growth", "Profitability", "Leverage", "Momentum"] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Performance" ? (
        <div className="min-h-[350px] flex-1 border-b border-border p-3">
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
      ) : (
        <div className="p-4 flex-1 overflow-auto">
          <div className="mb-3 text-xs text-muted-foreground flex justify-between">
            <span>Comparing peers for <strong>{primarySymbol}</strong></span>
            <span>As of: {peerData?.asOf ? new Date(peerData.asOf).toLocaleDateString() : "Live"}</span>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-panel text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Company</th>
                <th className="px-4 py-2 text-right font-medium">Metric</th>
                <th className="px-4 py-2 text-right font-medium">Peer Median</th>
                <th className="px-4 py-2 text-right font-medium">Sector Median</th>
                <th className="px-4 py-2 text-right font-medium">Percentile</th>
                <th className="px-4 py-2 text-right font-medium">Rank</th>
                <th className="px-4 py-2 text-right font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {peerData?.target && (
                <tr className="border-t border-border bg-primary/5 font-medium">
                  <td className="px-4 py-2 font-mono">{peerData.target.symbol} (Target)</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue(peerData.target, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.medians }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.sectorMedian }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{peerData.target.percentile}%</td>
                  <td className="px-4 py-2 text-right">#{peerData.target.rank}</td>
                  <td className="px-4 py-2 text-right">{(peerData.target.dataCoverage * 100).toFixed(0)}%</td>
                </tr>
              )}
              {peerData?.peers?.map((peer: any) => (
                <tr key={peer.symbol} className="border-t border-border/70">
                  <td className="px-4 py-2 font-mono">{peer.symbol}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue(peer, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.medians }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.sectorMedian }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{peer.percentile}%</td>
                  <td className="px-4 py-2 text-right">#{peer.rank}</td>
                  <td className="px-4 py-2 text-right">{(peer.dataCoverage * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="max-h-48 overflow-auto border-t border-border">
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
                  <td className="px-4 py-2 text-right font-mono">{quote?.volume?.toLocaleString("en-IN") ?? "—"}</td>
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
        <span>{isFetching ? "Refreshing market data…" : "Peer Comparison v1.0"}</span>
        <span className={isError ? "text-bear" : "text-bull"}>{isError ? "Data unavailable" : "Market feed active"}</span>
      </div>
    </div>
  );
}

function getTabMetricValue(entry: any, tab: TabType): string {
  const m = entry?.metrics ?? {};
  switch (tab) {
    case "Valuation":
      return m.peRatio !== undefined ? `P/E: ${m.peRatio.toFixed(1)}` : "—";
    case "Growth":
      return m.revenueGrowth !== undefined ? `Rev Growth: ${(m.revenueGrowth * 100).toFixed(1)}%` : "—";
    case "Profitability":
      return m.roe !== undefined ? `ROE: ${(m.roe * 100).toFixed(1)}%` : "—";
    case "Leverage":
      return m.debtToEquity !== undefined ? `D/E: ${m.debtToEquity.toFixed(2)}` : "—";
    case "Momentum":
      return m.relativeVolume !== undefined ? `RVol: ${m.relativeVolume.toFixed(2)}` : "—";
    default:
      return m.marketCap !== undefined ? `MCap: ₹${(m.marketCap / 1e7).toFixed(0)}Cr` : "—";
  }
}
