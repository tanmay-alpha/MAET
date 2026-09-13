import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Layers, LineChart, Download, Upload, Settings, TrendingDown, TrendingUp, ExternalLink, Zap, Building2, Sparkles, X } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { extractPaperOverlay } from "@/components/trading/chart-paper-overlay";
import { mapBacktestTradesToMarkers } from "@/components/trading/chart-trade-markers";
import { useChartLayout, useChartShortcuts, useFullscreen } from "@/hooks/use-chart-layout";
import { TiltCard } from "@/components/trading/tilt-card";
import { ContractPanel } from "@/components/common/contract-panel";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { ChartToolbar, DRAWING_TOOLS } from "@/components/trading/chart-toolbar";
import { getTradingViewUrl } from "@/lib/tradingview";
import type { MarketCandle } from "@/lib/market-api";
import type { ChartState } from "@/components/trading/candlestick-chart";
import type { ChartLayout } from "@/hooks/use-chart-layout";

export interface ChartSearch {
  exchange?: "NSE" | "BSE";
  sourceContext?: string;
  backtestRunId?: string;
  strategyId?: string;
}

export const Route = createFileRoute("/_app/chart/$symbol")({
  validateSearch: (search: Record<string, unknown>): ChartSearch => ({
    exchange: search.exchange === "BSE" ? "BSE" : "NSE",
    sourceContext: typeof search.sourceContext === "string" ? search.sourceContext : undefined,
    backtestRunId: typeof search.backtestRunId === "string" ? search.backtestRunId : undefined,
    strategyId: typeof search.strategyId === "string" ? search.strategyId : undefined,
  }),
  head: () => ({
    meta: [{ title: "Chart — MAET" }]
  }),
  component: ChartPage,
});

const TIMEFRAMES = {
  "1m": { timeframe: "1m", range: "1d", label: "1 Day" },
  "5m": { timeframe: "5m", range: "5d", label: "5 Days" },
  "10d": { timeframe: "1d", range: "10d", label: "10 Days" },
  "15m": { timeframe: "15m", range: "1mo", label: "1 Month" },
  "1h": { timeframe: "1h", range: "3mo", label: "3 Months" },
  "6mo": { timeframe: "1d", range: "6mo", label: "6 Months" },
  "1D": { timeframe: "1d", range: "1y", label: "1 Year" },
  "3Y": { timeframe: "1wk", range: "3y", label: "3 Years" },
  "5y": { timeframe: "1wk", range: "5y", label: "5 Years" },
  "max": { timeframe: "1wk", range: "max", label: "All" },
};

function IndicatorCard({ name, enabled, onChange, disabled = false, reason }: { name: string; enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean; reason?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={reason}
      onClick={() => onChange(!enabled)}
      className={`rounded-lg border p-3 text-left transition-colors ${
        enabled
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-panel text-muted-foreground hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-panel"
      }`}
    >
      <div className="font-medium">{name}</div>
    </button>
  );
}

function ChartPage() {
  const { symbol } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [activeBacktestRunId, setActiveBacktestRunId] = useState<string | undefined>(search.backtestRunId);

  useEffect(() => {
    setActiveBacktestRunId(search.backtestRunId);
  }, [search.backtestRunId]);

  // Backtest run trade retrieval
  const backtestRunQuery = useQuery({
    queryKey: ["backtestV2", "getRun", activeBacktestRunId],
    queryFn: () => trpc.backtestV2.getRun.query({ runId: activeBacktestRunId! }),
    enabled: Boolean(activeBacktestRunId),
  });

  // Map backtest trades to markers
  const tradeMarkers = useMemo(() => {
    const run = backtestRunQuery.data?.run || backtestRunQuery.data;
    const runResult = run?.result;
    const trades = runResult?.trades || [];
    if (!trades || trades.length === 0) return [];
    return mapBacktestTradesToMarkers(trades, symbol);
  }, [backtestRunQuery.data, symbol]);

  // Paper trading positions & orders overlay
  const { positions, orders } = usePaperAccount();
  const paperOverlay = useMemo(
    () => extractPaperOverlay(symbol, positions, orders),
    [symbol, positions, orders]
  );

  const [selectedTF, setSelectedTF] = useState<keyof typeof TIMEFRAMES>("5m");
  const [showVolume, setShowVolume] = useState(true);
  const [showMA, setShowMA] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [selectedChartType, setSelectedChartType] = useState<"candles" | "line" | "area">("candles");
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [chartState, setChartState] = useState<ChartState>({ zoom: 1, panOffset: 0, drawings: [] });
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Layout persistence
  const { layout, updateLayout, resetLayout, exportLayout, importLayout } = useChartLayout(symbol);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync layout state with chart
  useEffect(() => {
    if (layout) {
      setSelectedTF(layout.timeframe as keyof typeof TIMEFRAMES);
      setSelectedChartType(layout.chartType);
      setShowVolume(layout.indicators.volume);
      setShowMA(layout.indicators.ma);
      setShowRSI(layout.indicators.rsi);
      setShowMACD(layout.indicators.macd);
      setSelectedTool(layout.drawingTool);
    }
  }, [layout]);

  // Save layout when settings change
  useEffect(() => {
    updateLayout({
      timeframe: selectedTF,
      chartType: selectedChartType,
      indicators: {
        volume: showVolume,
        ma: showMA,
        rsi: showRSI,
        macd: showMACD,
      },
      drawingTool: selectedTool,
    });
  }, [selectedTF, selectedChartType, showVolume, showMA, showRSI, showMACD, selectedTool, updateLayout]);

  // Keyboard shortcuts
  useChartShortcuts({
    onToggleFullscreen: () => toggleFullscreen(),
    onZoomIn: () => setChartState((s) => ({ ...s, zoom: Math.min(5, s.zoom * 1.2) })),
    onZoomOut: () => setChartState((s) => ({ ...s, zoom: Math.max(0.2, s.zoom / 1.2) })),
    onResetZoom: () => setChartState((s) => ({ ...s, zoom: 1 })),
    onPanLeft: () => setChartState((s) => ({ ...s, panOffset: s.panOffset - 10 })),
    onPanRight: () => setChartState((s) => ({ ...s, panOffset: s.panOffset + 10 })),
    onSelectTool: setSelectedTool,
  });

  // Period switching shortcuts
  useEffect(() => {
    const handlePeriodKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.altKey) {
        const tfKeys = Object.keys(TIMEFRAMES);
        const currentIdx = tfKeys.indexOf(selectedTF);
        if (e.key === "ArrowRight" && currentIdx < tfKeys.length - 1) {
          setSelectedTF(tfKeys[currentIdx + 1] as keyof typeof TIMEFRAMES);
        } else if (e.key === "ArrowLeft" && currentIdx > 0) {
          setSelectedTF(tfKeys[currentIdx - 1] as keyof typeof TIMEFRAMES);
        }
      }
    };
    window.addEventListener("keydown", handlePeriodKey);
    return () => window.removeEventListener("keydown", handlePeriodKey);
  }, [selectedTF]);

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

  const handleZoomIn = () => setChartState((s) => ({ ...s, zoom: Math.min(5, s.zoom * 1.2) }));
  const handleZoomOut = () => setChartState((s) => ({ ...s, zoom: Math.max(0.2, s.zoom / 1.2) }));
  const handleResetZoom = () => setChartState((s) => ({ ...s, zoom: 1, panOffset: 0 }));

  const handleSaveLayout = () => {
    const layoutName = prompt("Enter layout name:");
    if (layoutName) {
      const layouts = JSON.parse(localStorage.getItem(`maet_chart_layouts_${symbol}`) || "{}");
      layouts[layoutName] = {
        chartState,
        selectedTF,
        selectedChartType,
        indicators: { volume: showVolume, ma: showMA, rsi: showRSI, macd: showMACD },
      };
      localStorage.setItem(`maet_chart_layouts_${symbol}`, JSON.stringify(layouts));
      alert(`Layout "${layoutName}" saved!`);
    }
  };

  const handleLoadLayout = () => {
    const layouts = JSON.parse(localStorage.getItem(`maet_chart_layouts_${symbol}`) || "{}");
    const layoutNames = Object.keys(layouts);
    if (layoutNames.length === 0) {
      alert("No saved layouts found.");
      return;
    }
    const layoutName = prompt(`Enter layout name to load:\n${layoutNames.join(", ")}`);
    if (layoutName && layouts[layoutName]) {
      const loaded = layouts[layoutName];
      setChartState(loaded.chartState || { zoom: 1, panOffset: 0, drawings: [] });
      setSelectedTF(loaded.selectedTF);
      setSelectedChartType(loaded.selectedChartType);
      setShowVolume(loaded.indicators.volume);
      setShowMA(loaded.indicators.ma);
      setShowRSI(loaded.indicators.rsi);
      setShowMACD(Boolean(loaded.indicators.macd));
    }
  };

  const handleExportLayout = () => {
    exportLayout(chartState);
  };

  const handleImportLayout = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      importLayout(file).then((layout) => {
        if (layout) {
          alert("Layout imported successfully!");
        } else {
          alert("Failed to import layout. Please check the file format.");
        }
      });
    }
    // Reset the file input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className={`h-screen bg-background flex flex-col ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>
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
            <div className="font-mono text-xl font-semibold mr-2">
              {currentPrice ? `₹${currentPrice.toFixed(2)}` : "—"}
            </div>

            {/* Quick Navigation: Terminal / Paper */}
            <button
              type="button"
              onClick={() => void navigate({ to: "/terminal" as any, search: { symbol, exchange: search.exchange || "NSE", sourceContext: "chart" } as any })}
              className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition"
              title="Trade this symbol in Paper Terminal"
            >
              <Zap className="h-3.5 w-3.5" />
              Terminal
            </button>

            {/* Quick Navigation: Backtest */}
            <button
              type="button"
              onClick={() => void navigate({ to: "/backtest" as any, search: { symbol, sourceContext: "chart" } as any })}
              className="flex items-center gap-1.5 rounded-lg border border-bull/30 bg-bull/10 px-3 py-1.5 text-xs font-semibold text-bull hover:bg-bull/20 transition"
              title="Backtest strategies for this symbol"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Backtest
            </button>

            {/* Quick Navigation: Stock Detail */}
            <button
              type="button"
              onClick={() => void navigate({ to: `/stock/${symbol}` as any })}
              className="rounded-lg border border-border bg-panel p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition"
              title="Company Financials & Overview"
            >
              <Building2 className="h-4 w-4" />
            </button>

            <a
              href={getTradingViewUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border bg-panel p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition"
              title="Open TradingView"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Backtest Run Trade Markers Banner */}
      {activeBacktestRunId && (
        <div className="flex items-center justify-between border-b border-primary/20 bg-primary/10 px-6 py-2 text-xs text-primary">
          <div className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>
              Overlaying <strong>{tradeMarkers.length}</strong> strategy trade markers from Backtest Run{" "}
              <code className="rounded bg-primary/20 px-1 py-0.5 font-mono text-[11px]">{activeBacktestRunId.slice(0, 8)}</code>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveBacktestRunId(undefined)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-primary/20 font-medium"
            title="Clear trade markers overlay"
          >
            <X className="h-3.5 w-3.5" />
            Hide Markers
          </button>
        </div>
      )}

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
                title={`Press Alt + Arrow keys to switch periods`}
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
              title="Candlestick Chart (C)"
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
              title="Line Chart (L)"
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
              title="Area Chart (A)"
            >
              <Layers className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowShortcutsHelp(!showShortcutsHelp)}
              className={`p-2 rounded-md ${
                showShortcutsHelp
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
              title="Keyboard Shortcuts (?)"
            >
              <span className="text-xs font-bold">?</span>
            </button>
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        {showShortcutsHelp && (
          <div className="border-b border-border bg-panel/95 backdrop-blur px-6 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="font-semibold mb-2 text-primary">Period Switching</div>
                <div className="space-y-1 text-muted-foreground">
                  <div><kbd className="bg-panel px-1 rounded">Alt</kbd> + <kbd className="bg-panel px-1 rounded">←</kbd> Previous period</div>
                  <div><kbd className="bg-panel px-1 rounded">Alt</kbd> + <kbd className="bg-panel px-1 rounded">→</kbd> Next period</div>
                </div>
              </div>
              <div>
                <div className="font-semibold mb-2 text-primary">Zoom & Pan</div>
                <div className="space-y-1 text-muted-foreground">
                  <div><kbd className="bg-panel px-1 rounded">+</kbd> Zoom in</div>
                  <div><kbd className="bg-panel px-1 rounded">-</kbd> Zoom out</div>
                  <div><kbd className="bg-panel px-1 rounded">0</kbd> Reset zoom</div>
                </div>
              </div>
              <div>
                <div className="font-semibold mb-2 text-primary">Drawing Tools</div>
                <div className="space-y-1 text-muted-foreground">
                  <div><kbd className="bg-panel px-1 rounded">T</kbd> Trendline</div>
                  <div><kbd className="bg-panel px-1 rounded">H</kbd> Horizontal</div>
                  <div><kbd className="bg-panel px-1 rounded">F</kbd> Fibonacci</div>
                  <div><kbd className="bg-panel px-1 rounded">Esc</kbd> Exit tool</div>
                </div>
              </div>
              <div>
                <div className="font-semibold mb-2 text-primary">View</div>
                <div className="space-y-1 text-muted-foreground">
                  <div><kbd className="bg-panel px-1 rounded">F11</kbd> Fullscreen</div>
                  <div><kbd className="bg-panel px-1 rounded">S</kbd> Support/Resistance</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Chart Area */}
        <div className="flex-1 flex">
          {/* Chart Canvas */}
          <div className="flex-1 p-6">
            <TiltCard max={5} className="h-full">
              <div className="h-full rounded-2xl border border-border bg-panel/95 p-4 relative">
                <ChartToolbar
                  onToolSelect={setSelectedTool}
                  onToggleFullscreen={() => toggleFullscreen()}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onResetZoom={handleResetZoom}
                  selectedTool={selectedTool}
                  fullscreen={isFullscreen}
                  onSaveLayout={handleSaveLayout}
                  onLoadLayout={handleLoadLayout}
                />

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
                  <div className="h-full flex flex-col pt-14">
                    <CandlestickChart
                      data={candles}
                      height={420}
                      seriesType={selectedChartType === "candles" ? "candlestick" : selectedChartType}
                      chartState={chartState}
                      onChartStateChange={setChartState}
                      drawingTool={selectedTool}
                      indicators={{ sma: showMA, ema: showMA, rsi: showRSI, macd: showMACD, volume: showVolume }}
                      trades={tradeMarkers}
                      paperOverlay={paperOverlay}
                    />
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
                    <span className="font-mono">{candles[candles.length - 1]?.o.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">High</span>
                    <span className="font-mono">{candles[candles.length - 1]?.h.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Low</span>
                    <span className="font-mono">{candles[candles.length - 1]?.l.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Close</span>
                    <span className="font-mono">{candles[candles.length - 1]?.c.toFixed(2) || "—"}</span>
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
                    enabled={showMACD}
                    onChange={setShowMACD}
                  />
                </div>
              </div>
            </TiltCard>

            {/* Layout Actions */}
            <TiltCard>
              <div className="p-4">
                <h3 className="font-semibold mb-3">Layout</h3>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleSaveLayout}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border hover:bg-accent/50 transition-colors flex items-center gap-2"
                  >
                    Save Current Layout
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadLayout}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border hover:bg-accent/50 transition-colors flex items-center gap-2"
                  >
                    Load Saved Layout
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetLayout();
                      setChartState({ zoom: 1, panOffset: 0, drawings: [] });
                    }}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border hover:bg-accent/50 transition-colors flex items-center gap-2"
                  >
                    Reset to Defaults
                  </button>
                  <div className="border-t border-border pt-2 mt-2">
                    <div className="text-xs text-muted-foreground mb-2">Export / Import</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleExportLayout}
                        className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border hover:bg-accent/50 transition-colors flex items-center justify-center gap-1"
                        title="Export layout to JSON"
                      >
                        <Download className="h-3 w-3" />
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={triggerFileInput}
                        className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border hover:bg-accent/50 transition-colors flex items-center justify-center gap-1"
                        title="Import layout from JSON"
                      >
                        <Upload className="h-3 w-3" />
                        Import
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportLayout}
                      className="hidden"
                      aria-label="Import layout from JSON file"
                    />
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>
        </div>
      </div>
    </div>
  );
}
