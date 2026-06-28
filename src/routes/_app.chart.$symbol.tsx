import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Layers, LineChart, Settings, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { TiltCard } from "@/components/trading/tilt-card";
import { ContractPanel } from "@/components/common/contract-panel";
import type { MarketCandle } from "@/lib/market-api";

export const Route = createFileRoute("/_app/chart/$symbol")({
  head: () => ({
    meta: [{ title: "Chart — MAET" }]
  }),
  component: ChartPage,
});

const TIMEFRAMES = {
  "1m": { timeframe: "1m", range: "1d", label: "1 Day" },
  "5m": { timeframe: "5m", range: "5d", label: "5 Days" },
  "15m": { timeframe: "15m", range: "1mo", label: "1 Month" },
  "1h": { timeframe: "1h", range: "3mo", label: "3 Months" },
  "1D": { timeframe: "1d", range: "1y", label: "1 Year" },
  "1W": { timeframe: "1wk", range: "2y", label: "2 Years" },
};

function IndicatorCard({ name, enabled, onChange }: { name: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`rounded-lg border p-3 text-left transition-colors ${
        enabled
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-panel text-muted-foreground hover:bg-accent/50"
      }`}
    >
      <div className="font-medium">{name}</div>
    </button>
  );
}

function ChartPage() {
  const { symbol } = Route.useParams();
  const navigate = useNavigate();
  const [selectedTF, setSelectedTF] = useState<keyof typeof TIMEFRAMES>("5m");
  const [showVolume, setShowVolume] = useState(true);
  const [showMA, setShowMA] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [selectedChartType, setSelectedChartType] = useState<"candles" | "line" | "area">("candles");

  const { quoteMap, streamConnected } = useMarketQuotes([symbol]);
  const liveQuote = quoteMap.get(symbol);
  const tf = TIMEFRAMES[selectedTF];
  const candleQuery = useMarketCandles(symbol, tf.timeframe as MarketCandle["tf"], tf.range);

  const candles = useMemo(
    () => (candleQuery.data?.candles ?? []).map((candle) => ({
      t: new Date(candle.ts).getTime(),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume,
    })),
    [candleQuery.data?.candles]
  );

  const currentPrice = liveQuote?.price;
  const volume = liveQuote?.volume;
  const previousClose = liveQuote?.previousClose;

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border bg-panel">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate({ to: "/" })}
              className="rounded-lg border border-border bg-panel p-2 hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-lg font-semibold">{symbol}</h1>
              <div className="text-sm text-muted-foreground">
                {previousClose && currentPrice && (
                  <span className={`${currentPrice > previousClose ? "text-bull" : "text-bear"}`}>
                    {((currentPrice - previousClose) / previousClose * 100).toFixed(2)}%
                  </span>
                )}
                <span className="mx-2">|</span>
                <span className={`font-mono ${streamConnected ? "text-bull" : "text-muted-foreground"}`}>
                  {streamConnected ? "Live" : "Delayed"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="font-mono text-xl font-semibold">
              {currentPrice?.toFixed(2) || "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Time Period Selector */}
        <div className="flex items-center justify-between border-b border-border px-6 py-2">
          <div className="flex gap-1">
            {Object.entries(TIMEFRAMES).map(([key, tf]) => (
              <button
                key={key}
                onClick={() => setSelectedTF(key as keyof typeof TIMEFRAMES)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  selectedTF === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedChartType("candles")}
              className={`p-2 rounded-md ${
                selectedChartType === "candles"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <BarChart3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSelectedChartType("line")}
              className={`p-2 rounded-md ${
                selectedChartType === "line"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <LineChart className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSelectedChartType("area")}
              className={`p-2 rounded-md ${
                selectedChartType === "area"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Layers className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="flex-1 flex">
          {/* Chart Canvas */}
          <div className="flex-1 p-6">
            <TiltCard max={5} className="h-full">
              <div className="h-full rounded-2xl border border-border bg-panel/95 p-4">
                {candleQuery.isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-lg font-semibold mb-2">Loading chart...</div>
                      <div className="text-sm text-muted-foreground">
                        Fetching {tf.label} data from Yahoo
                      </div>
                    </div>
                  </div>
                ) : candleQuery.isError ? (
                  <div className="h-full flex items-center justify-center">
                    <ContractPanel symbol={symbol} />
                  </div>
                ) : candles.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-lg font-semibold mb-2">No data</div>
                      <div className="text-sm text-muted-foreground">
                        No historical data available for {symbol}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col">
                    {/* Chart Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-medium">{tf.label} Chart</div>
                      <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                        <span>O: {candles[candles.length - 1]?.o.toFixed(2)}</span>
                        <span>H: {candles[candles.length - 1]?.h.toFixed(2)}</span>
                        <span>L: {candles[candles.length - 1]?.l.toFixed(2)}</span>
                        <span>C: {candles[candles.length - 1]?.c.toFixed(2)}</span>
                        {volume && <span>V: {volume.toLocaleString()}</span>}
                      </div>
                    </div>

                    {/* Chart Visualization */}
                    <div className="flex-1 bg-panel/80 rounded-lg border border-border flex items-center justify-center relative">
                      <div className="text-center">
                        <div className="text-2xl font-semibold mb-2">Interactive Chart</div>
                        <div className="text-sm text-muted-foreground max-w-md">
                          Full charting interface with drawing tools, indicators,
                          and technical analysis features. Support for candlesticks,
                          line charts, area charts, multiple timeframes, and overlays.
                        </div>

                        {/* Mock Chart */}
                        <div className="mt-6 relative h-64 w-full mx-auto border border-border rounded">
                          <div className="absolute inset-0 flex items-end justify-center gap-px">
                            {candles.slice(-30).map((candle, i) => (
                              <div
                                key={i}
                                className="w-px bg-gradient-to-t from-bull/20 to-bull"
                                style={{ height: `${Math.random() * 80 + 20}%` }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Volume Bars */}
                    {showVolume && (
                      <div className="mt-4 h-12 bg-panel/80 rounded border border-border flex items-end justify-center gap-px">
                        {candles.slice(-30).map((candle, i) => (
                          <div
                            key={i}
                            className="w-px bg-gradient-to-t from-muted to-foreground/20"
                            style={{ height: `${Math.random() * 60 + 20}%` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TiltCard>
          </div>

          {/* Sidebar */}
          <div className="w-80 border-l border-border p-6 space-y-4">
            {/* Price Info */}
            <TiltCard>
              <div className="p-4">
                <h3 className="font-semibold mb-3">Price</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open</span>
                    <span className="font-mono">{currentPrice?.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Previous Close</span>
                    <span className="font-mono">{previousClose?.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span className="font-mono">{volume?.toLocaleString() || "—"}</span>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Indicators */}
            <TiltCard>
              <div className="p-4">
                <h3 className="font-semibold mb-3">Indicators</h3>
                <div className="grid grid-cols-2 gap-2">
                  <IndicatorCard
                    name="Volume"
                    enabled={showVolume}
                    onChange={setShowVolume}
                  />
                  <IndicatorCard
                    name="Moving Avg"
                    enabled={showMA}
                    onChange={setShowMA}
                  />
                  <IndicatorCard
                    name="RSI"
                    enabled={showRSI}
                    onChange={setShowRSI}
                  />
                  <IndicatorCard
                    name="MACD"
                    enabled={false}
                    onChange={() => {}}
                  />
                </div>
              </div>
            </TiltCard>

            {/* Drawing Tools */}
            <TiltCard>
              <div className="p-4">
                <h3 className="font-semibold mb-3">Drawing Tools</h3>
                <div className="grid grid-cols-4 gap-2">
                  {["Trend", "HLine", "VLine", "Fib"].map((tool) => (
                    <button
                      key={tool}
                      className="border border-border rounded p-2 text-xs hover:bg-accent/50"
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>
            </TiltCard>
          </div>
        </div>
      </div>
    </div>
  );
}