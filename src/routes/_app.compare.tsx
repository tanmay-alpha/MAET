import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Plus, X, Layers } from "lucide-react";
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
import type { PeerComparisonEntry, PeerMetric } from "../../server/modules/peers/contracts";

export const Route = createFileRoute("/_app/compare")({
  head: () => ({ meta: [{ title: "Compare — MAET" }] }),
  component: Compare,
});

const COLORS = ["#2962ff", "#26a69a", "#ef5350", "#f59e0b", "#8b5cf6"];

type TabType = "Performance" | "Valuation" | "Growth" | "Profitability" | "Leverage" | "Momentum";
type RangeType = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
type ChartMode = "pct" | "indexed" | "price";

const RANGE_LABELS: { id: RangeType; label: string }[] = [
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "2y", label: "2Y" },
  { id: "5y", label: "5Y" },
];

const PRESETS = [
  { name: "IT Giants", symbols: ["TCS", "INFY", "WIPRO", "HCLTECH"] },
  { name: "Private Banking", symbols: ["HDFCBANK", "ICICIBANK", "KOTAKBANK", "AXISBANK"] },
  { name: "Auto Leaders", symbols: ["MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO"] },
  { name: "Energy & Conglomerate", symbols: ["RELIANCE", "ONGC", "NTPC", "POWERGRID"] },
];

function Compare() {
  const [symbols, setSymbols] = useState(["RELIANCE", "TCS", "INFY"]);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("Performance");
  const [selectedRange, setSelectedRange] = useState<RangeType>("3mo");
  const [chartMode, setChartMode] = useState<ChartMode>("pct");
  const primarySymbol = symbols[0] || "RELIANCE";

  const { quoteMap, isFetching, isError } = useMarketQuotes(symbols);

  const peerQuery = useQuery({
    queryKey: ["peerComparison", primarySymbol],
    queryFn: () => trpc.companies.getPeerComparison.query({ symbol: primarySymbol, limit: 6 }),
  });

  const candleQueries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["compare-candles", symbol, selectedRange],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchMarketCandles(symbol, "1d", selectedRange, signal),
      staleTime: 60_000,
      retry: 2,
    })),
  });

  // Calculate synchronized chronological chart data
  const chartData = useMemo(() => {
    const symbolSeries = symbols.map((symbol, idx) => {
      const candles = candleQueries[idx]?.data?.candles ?? [];
      const dateMap = new Map<string, number>();
      candles.forEach((c) => {
        const dKey = c.ts.split("T")[0];
        dateMap.set(dKey, c.close);
      });
      return { symbol, candles, dateMap };
    });

    const allDates = Array.from(
      new Set(symbolSeries.flatMap((s) => Array.from(s.dateMap.keys())))
    ).sort();

    if (allDates.length === 0) return [];

    const basePrices = new Map<string, number>();
    symbolSeries.forEach((s) => {
      if (s.candles.length > 0) {
        basePrices.set(s.symbol, s.candles[0].close);
      }
    });

    return allDates.map((dateStr) => {
      const d = new Date(dateStr);
      const formattedDate = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const row: Record<string, string | number> = {
        date: formattedDate,
        fullDate: dateStr,
      };

      symbolSeries.forEach((s) => {
        const price = s.dateMap.get(dateStr);
        const base = basePrices.get(s.symbol);
        if (price !== undefined && base !== undefined && base > 0) {
          if (chartMode === "pct") {
            row[s.symbol] = Number((((price - base) / base) * 100).toFixed(2));
          } else if (chartMode === "indexed") {
            row[s.symbol] = Number(((price / base) * 100).toFixed(2));
          } else {
            row[s.symbol] = Number(price.toFixed(2));
          }
        }
      });
      return row;
    });
  }, [candleQueries, symbols, chartMode]);

  // Compute period summary statistics for each symbol
  const performanceStats = useMemo(() => {
    return symbols.map((symbol, idx) => {
      const candles = candleQueries[idx]?.data?.candles ?? [];
      if (candles.length < 2) {
        return {
          symbol,
          returnPct: null,
          maxDrawdown: null,
          volatility: null,
          high: null,
          low: null,
        };
      }

      const closes = candles.map((c) => c.close);
      const first = closes[0];
      const last = closes[closes.length - 1];
      const returnPct = ((last - first) / first) * 100;
      const high = Math.max(...closes);
      const low = Math.min(...closes);

      // Max drawdown
      let peak = closes[0];
      let maxDd = 0;
      for (const p of closes) {
        if (p > peak) peak = p;
        const dd = ((peak - p) / peak) * 100;
        if (dd > maxDd) maxDd = dd;
      }

      // Annualized volatility
      const dailyReturns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance =
        dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
        (dailyReturns.length - 1 || 1);
      const dailyVol = Math.sqrt(variance);
      const annualizedVol = dailyVol * Math.sqrt(252) * 100;

      return {
        symbol,
        returnPct,
        maxDrawdown: maxDd,
        volatility: annualizedVol,
        high,
        low,
      };
    });
  }, [candleQueries, symbols]);

  const addSymbol = (symToAdd?: string) => {
    const normalized = (symToAdd ?? input).trim().toUpperCase();
    if (normalized && !symbols.includes(normalized) && symbols.length < 5) {
      setSymbols((current) => [...current, normalized]);
      if (!symToAdd) setInput("");
    }
  };

  const removeSymbol = (symbolToRemove: string) => {
    if (symbols.length > 1) {
      setSymbols((current) => current.filter((s) => s !== symbolToRemove));
    }
  };

  const toggleSymbol = (sym: string) => {
    if (symbols.includes(sym)) {
      removeSymbol(sym);
    } else {
      addSymbol(sym);
    }
  };

  const peerData = peerQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-semibold text-sm">Compare</span>
          {peerData?.selectionBasis === "industry" && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
              Industry Peers ({peerData.selectionLabel})
            </span>
          )}
          {peerData?.selectionBasis === "sector" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-500">
              Sector Fallback ({peerData.selectionLabel})
            </span>
          )}
          {peerData?.selectionBasis === "none" && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              Selected Peers
            </span>
          )}

          {/* Active Symbol Badges */}
          {symbols.map((symbol, index) => (
            <div
              key={symbol}
              className="flex items-center gap-2 rounded border border-border bg-background px-2.5 py-1 text-xs"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index] }} />
              <span className="font-mono font-semibold">{symbol}</span>
              {symbols.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSymbol(symbol)}
                  aria-label={`Remove ${symbol}`}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          ))}

          {/* Add Symbol Input */}
          {symbols.length < 5 && (
            <div className="ml-1 flex items-center rounded border border-border bg-background">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addSymbol()}
                placeholder="Add symbol"
                className="w-24 bg-transparent px-2 py-1 text-xs uppercase outline-none"
                aria-label="Symbol to compare"
              />
              <button
                type="button"
                onClick={() => addSymbol()}
                className="border-l border-border p-1 text-muted-foreground hover:text-primary"
                aria-label="Add comparison symbol"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setSymbols(p.symbols.slice(0, 5))}
              className="rounded bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted border border-border"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs & Controls Ribbon */}
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-panel px-4 text-xs font-medium">
        <div className="flex">
          {(["Performance", "Valuation", "Growth", "Profitability", "Leverage", "Momentum"] as TabType[]).map(
            (tab) => (
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
            )
          )}
        </div>

        {activeTab === "Performance" && (
          <div className="flex items-center gap-3 py-1.5">
            {/* Range Selector */}
            <div className="flex items-center rounded border border-border bg-background p-0.5 text-[11px]">
              {RANGE_LABELS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRange(r.id)}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    selectedRange === r.id
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Chart Mode Selector */}
            <div className="flex items-center rounded border border-border bg-background p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setChartMode("pct")}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  chartMode === "pct"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Return %
              </button>
              <button
                type="button"
                onClick={() => setChartMode("indexed")}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  chartMode === "indexed"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Index 100
              </button>
              <button
                type="button"
                onClick={() => setChartMode("price")}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  chartMode === "price"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Price (₹)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main View Area */}
      {activeTab === "Performance" ? (
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Key Period Metrics Ribbon */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 border-b border-border bg-background/50 p-2.5 text-xs">
            {performanceStats.map((stat, index) => {
              const quote = quoteMap.get(stat.symbol);
              return (
                <div
                  key={stat.symbol}
                  className="rounded border border-border bg-panel p-2 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold font-mono">
                      <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index] }} />
                      <span>{stat.symbol}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      ₹{quote?.price?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase">{selectedRange} Return</span>
                    <span
                      className={`font-mono text-xs font-semibold ${
                        (stat.returnPct ?? 0) >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {stat.returnPct !== null
                        ? `${stat.returnPct >= 0 ? "+" : ""}${stat.returnPct.toFixed(2)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Max DD: {stat.maxDrawdown !== null ? `${stat.maxDrawdown.toFixed(1)}%` : "—"}</span>
                    <span>Vol: {stat.volatility !== null ? `${stat.volatility.toFixed(1)}%` : "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Line Chart */}
          <div className="min-h-[320px] flex-1 border-b border-border p-3">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 14, right: 28, bottom: 6, left: 4 }}>
                  <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--color-muted-foreground)"
                    tick={{ fontSize: 10 }}
                    minTickGap={34}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value) =>
                      chartMode === "pct"
                        ? `${Number(value).toFixed(0)}%`
                        : chartMode === "indexed"
                        ? Number(value).toFixed(0)
                        : `₹${Number(value).toFixed(0)}`
                    }
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-panel-elevated)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 4,
                    }}
                    formatter={(value) => [
                      chartMode === "pct"
                        ? `${Number(value).toFixed(2)}%`
                        : chartMode === "indexed"
                        ? Number(value).toFixed(2)
                        : `₹${Number(value).toFixed(2)}`,
                      "",
                    ]}
                  />
                  <Legend />
                  {symbols.map((symbol, index) => (
                    <Line
                      key={symbol}
                      dataKey={symbol}
                      stroke={COLORS[index]}
                      dot={false}
                      strokeWidth={1.8}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {isError ? "Market history is temporarily unavailable" : "Loading comparison data…"}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 flex-1 overflow-auto">
          <div className="mb-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
            <span>
              Comparing peers for <strong>{primarySymbol}</strong>
            </span>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>As of: {peerData?.asOf ? new Date(peerData.asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              {peerData?.target?.latestFundamentalsAt && (
                <span>Fundamentals: {new Date(peerData.target.latestFundamentalsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
              )}
            </div>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-panel text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Company</th>
                <th className="px-4 py-2 text-right font-medium">Metric</th>
                <th className="px-4 py-2 text-right font-medium">Peer Median</th>
                <th className="px-4 py-2 text-right font-medium">Comparison Median</th>
                <th className="px-4 py-2 text-right font-medium">Percentile</th>
                <th className="px-4 py-2 text-right font-medium">Rank</th>
                <th className="px-4 py-2 text-right font-medium">Coverage</th>
                <th className="px-4 py-2 text-center font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {peerData?.target && (
                <tr className="border-t border-border bg-primary/5 font-medium">
                  <td className="px-4 py-2 font-mono">{peerData.target.symbol} (Target)</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue(peerData.target, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.medians }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.comparisonMedian }, activeTab)}</td>
                  <td className="px-4 py-2 text-right">{peerData.target.percentile}%</td>
                  <td className="px-4 py-2 text-right">#{peerData.target.rank}</td>
                  <td className="px-4 py-2 text-right">{(peerData.target.dataCoverage * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2 text-center">
                    <span className="text-[10px] text-muted-foreground">Primary</span>
                  </td>
                </tr>
              )}
              {peerData?.peers?.map((peer: PeerComparisonEntry) => {
                const isSelected = symbols.includes(peer.symbol);
                return (
                  <tr key={peer.symbol} className="border-t border-border/70 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-2 font-mono">{peer.symbol}</td>
                    <td className="px-4 py-2 text-right">{getTabMetricValue(peer, activeTab)}</td>
                    <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.medians }, activeTab)}</td>
                    <td className="px-4 py-2 text-right">{getTabMetricValue({ metrics: peerData.comparisonMedian }, activeTab)}</td>
                    <td className="px-4 py-2 text-right">{peer.percentile}%</td>
                    <td className="px-4 py-2 text-right">#{peer.rank}</td>
                    <td className="px-4 py-2 text-right">{(peer.dataCoverage * 100).toFixed(0)}%</td>
                    <td className="px-4 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSymbol(peer.symbol)}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          isSelected
                            ? "bg-primary/20 text-primary hover:bg-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Added</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3" />
                            <span>Compare</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quote Feed Table */}
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
                <tr key={symbol} className="border-t border-border/70 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono font-semibold text-primary">{symbol}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {quote?.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${
                      (quote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {quote?.changePct === undefined
                      ? "—"
                      : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {quote?.previousClose?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {quote?.volume?.toLocaleString("en-IN") ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {quote?.ts
                      ? new Date(quote.ts).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Status Bar */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>{isFetching ? "Refreshing market data…" : "Multi-Asset Peer Comparison v2.0"}</span>
        <span className={isError ? "text-bear" : "text-bull"}>
          {isError ? "Data unavailable" : "Market feed active"}
        </span>
      </div>
    </div>
  );
}

export function getTabMetricValue(
  entry?: { metrics?: Partial<PeerMetric> } | null,
  tab: TabType = "Performance"
): string {
  const m = entry?.metrics ?? {};
  switch (tab) {
    case "Valuation":
      return m.peRatio !== undefined ? `P/E: ${m.peRatio.toFixed(1)}` : "—";
    case "Growth":
      return m.revenueGrowth !== undefined
        ? `Rev Growth: ${(m.revenueGrowth * 100).toFixed(1)}%`
        : "—";
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
