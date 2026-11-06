import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Layers, LineChart, Download, Upload, ExternalLink, Building2, X } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { extractPaperOverlay } from "@/components/trading/chart-paper-overlay";
import { mapBacktestTradesToMarkers } from "@/components/trading/chart-trade-markers";
import { useChartLayout, useChartShortcuts, useFullscreen } from "@/hooks/use-chart-layout";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { ChartToolbar } from "@/components/trading/chart-toolbar";
import { getTradingViewUrl } from "@/lib/tradingview";
import { quoteSourceLabel, sourceName } from "@/lib/quote-source";
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

type TimeframeKey = keyof typeof TIMEFRAMES;

function isTimeframeKey(value: string): value is TimeframeKey {
  return value in TIMEFRAMES;
}

const DEFAULT_CHART_STATE: ChartState = { zoom: 1, panOffset: 0, drawings: [] };

const CHART_TYPES: { type: ChartLayout["chartType"]; title: string; icon: typeof BarChart3 }[] = [
  { type: "candles", title: "Candlestick chart", icon: BarChart3 },
  { type: "line", title: "Line chart", icon: LineChart },
  { type: "area", title: "Area chart", icon: Layers },
];

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "Period", items: [["Alt ←", "Previous period"], ["Alt →", "Next period"]] },
  { title: "Zoom and pan", items: [["+ / −", "Zoom in / out"], ["0", "Reset zoom"], ["← / →", "Pan"]] },
  { title: "Drawing", items: [["T", "Trendline"], ["H", "Horizontal"], ["V", "Vertical"], ["F", "Fibonacci"], ["S", "Support/resistance"], ["Esc", "Leave tool"]] },
  { title: "View", items: [["F11", "Fullscreen"]] },
];

const PRICE_FORMAT: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const SIDE_BUTTON = "rounded border border-border px-2 py-1.5 text-xs hover:bg-accent/50";

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

  const [chartState, setChartState] = useState<ChartState>(DEFAULT_CHART_STATE);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [layoutPanel, setLayoutPanel] = useState<"save" | "load" | null>(null);
  const [layoutName, setLayoutName] = useState("");
  const [layoutMessage, setLayoutMessage] = useState<string | null>(null);

  // The persisted layout is the single source of truth for the chart's view settings.
  const {
    layout,
    updateLayout,
    updateIndicator,
    resetLayout,
    namedLayoutNames,
    saveNamedLayout,
    loadNamedLayout,
    deleteNamedLayout,
    exportLayout,
    importLayout,
  } = useChartLayout(symbol);
  const selectedTF: TimeframeKey = isTimeframeKey(layout.timeframe) ? layout.timeframe : "5m";
  const selectedChartType = layout.chartType;
  const selectedTool = layout.drawingTool;
  const { volume: showVolume, ma: showMA, rsi: showRSI, macd: showMACD } = layout.indicators;
  const setSelectedTF = (timeframe: TimeframeKey) => updateLayout({ timeframe });
  const setSelectedTool = (drawingTool: string | null) => updateLayout({ drawingTool });
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useChartShortcuts({
    onToggleFullscreen: () => toggleFullscreen(),
    onZoomIn: () => setChartState((s) => ({ ...s, zoom: Math.min(5, s.zoom * 1.2) })),
    onZoomOut: () => setChartState((s) => ({ ...s, zoom: Math.max(0.2, s.zoom / 1.2) })),
    onResetZoom: () => setChartState((s) => ({ ...s, zoom: 1 })),
    onPanLeft: () => setChartState((s) => ({ ...s, panOffset: s.panOffset - 10 })),
    onPanRight: () => setChartState((s) => ({ ...s, panOffset: s.panOffset + 10 })),
    onSelectTool: setSelectedTool,
    onEscape: () => setSelectedTool(null),
  });

  // Period switching shortcuts
  useEffect(() => {
    const handlePeriodKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.altKey) {
        const tfKeys = Object.keys(TIMEFRAMES);
        const currentIdx = tfKeys.indexOf(selectedTF);
        const next = e.key === "ArrowRight" ? tfKeys[currentIdx + 1] : e.key === "ArrowLeft" ? tfKeys[currentIdx - 1] : undefined;
        if (next && isTimeframeKey(next)) updateLayout({ timeframe: next });
      }
    };
    window.addEventListener("keydown", handlePeriodKey);
    return () => window.removeEventListener("keydown", handlePeriodKey);
  }, [selectedTF, updateLayout]);

  const quotes = useMarketQuotes([symbol]);
  const liveQuote = quotes.quoteMap.get(symbol);
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
  const lastBar = candles.at(-1);

  const currentPrice = liveQuote?.price;
  const changePct = liveQuote?.changePct;
  const quoteLabel = liveQuote
    ? quoteSourceLabel(liveQuote.source, liveQuote.delayed, quotes.marketPhase)
    : quotes.isError ? "Quote unavailable" : "Loading quote…";
  const candleSource = candleQuery.data
    ? `${sourceName(candleQuery.data.source)}${candleQuery.data.delayed ? " · delayed" : ""}`
    : undefined;

  const handleZoomIn = () => setChartState((s) => ({ ...s, zoom: Math.min(5, s.zoom * 1.2) }));
  const handleZoomOut = () => setChartState((s) => ({ ...s, zoom: Math.max(0.2, s.zoom / 1.2) }));
  const handleResetZoom = () => setChartState((s) => ({ ...s, zoom: 1, panOffset: 0 }));

  const handleSaveLayout = (event: React.FormEvent) => {
    event.preventDefault();
    const name = layoutName.trim();
    if (!name) return;
    if (!saveNamedLayout(name, chartState)) {
      setLayoutMessage("Could not save the layout: browser storage is unavailable or full.");
      return;
    }
    setLayoutName("");
    setLayoutPanel(null);
    setLayoutMessage(`Layout "${name}" saved.`);
  };

  const handleLoadLayout = (name: string) => {
    const saved = loadNamedLayout(name);
    if (!saved) return;
    setChartState(saved.chartState ?? DEFAULT_CHART_STATE);
    setLayoutPanel(null);
    setLayoutMessage(`Layout "${name}" loaded.`);
  };

  const toggleLayoutPanel = (panel: "save" | "load") => {
    setLayoutMessage(null);
    setLayoutPanel((current) => (current === panel ? null : panel));
  };

  const handleImportLayout = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void importLayout(file).then((ok) => {
        setLayoutMessage(ok ? "Layout imported." : "That file is not a MAET layout export.");
      });
    }
    // Reset the file input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={`flex h-full min-h-0 flex-col bg-background ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>
      {/* Header */}
      <header className="border-b border-border bg-panel px-3 py-2 lg:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => navigate({ to: "/screener" })}
            className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to screener"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold">{symbol}</h1>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-semibold tabular-nums">
              {currentPrice !== undefined ? `₹${currentPrice.toLocaleString("en-IN", PRICE_FORMAT)}` : "—"}
            </span>
            {changePct !== undefined && (
              <span className={`font-mono text-sm tabular-nums ${changePct >= 0 ? "text-bull" : "text-bear"}`}>
                {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">{quoteLabel}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void navigate({ to: "/terminal" as any, search: { symbol, exchange: search.exchange || "NSE", sourceContext: "chart" } as any })}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              title="Trade this symbol in the paper terminal"
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: "/backtest" as any, search: { symbol, sourceContext: "chart" } as any })}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              title="Backtest strategies for this symbol"
            >
              Backtest
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: `/stock/${symbol}` as any })}
              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Company page"
              aria-label="Company page"
            >
              <Building2 className="h-4 w-4" />
            </button>
            <a
              href={getTradingViewUrl(symbol)}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open in TradingView"
              aria-label="Open in TradingView"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Backtest run trade markers */}
      {activeBacktestRunId && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-panel px-3 py-1.5 text-xs lg:px-5">
          <span>
            {tradeMarkers.length} trade markers from backtest run{" "}
            <code className="font-mono text-[11px] text-muted-foreground">{activeBacktestRunId.slice(0, 8)}</code>
          </span>
          <button
            type="button"
            onClick={() => setActiveBacktestRunId(undefined)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Hide markers
          </button>
        </div>
      )}

      {/* Below lg the chart and sidebar stack and this area scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        {/* Time period selector */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 lg:px-5">
          <div className="flex min-w-0 gap-0.5 overflow-x-auto">
            {Object.entries(TIMEFRAMES).map(([key, option]) => (
              <button
                key={key}
                type="button"
                onClick={() => isTimeframeKey(key) && setSelectedTF(key)}
                className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs ${
                  selectedTF === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
                title="Alt + arrow keys switch periods"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {CHART_TYPES.map(({ type, title, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => updateLayout({ chartType: type })}
                className={`rounded p-1.5 ${
                  selectedChartType === type
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
                title={title}
                aria-label={title}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowShortcutsHelp(!showShortcutsHelp)}
              aria-expanded={showShortcutsHelp}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                showShortcutsHelp
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
        </div>

        {showShortcutsHelp && (
          <div className="grid grid-cols-2 gap-4 border-b border-border bg-panel px-3 py-3 text-xs md:grid-cols-4 lg:px-5">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1.5 font-semibold">{group.title}</div>
                <dl className="space-y-0.5 text-muted-foreground">
                  {group.items.map(([keys, action]) => (
                    <div key={keys} className="flex gap-2">
                      <dt className="w-12 shrink-0 font-mono text-foreground">{keys}</dt>
                      <dd>{action}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}

        {/* Side by side from lg up; stacked below so the chart keeps the full width. */}
        <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
          {/* Chart */}
          <div className="flex min-w-0 flex-col lg:flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 lg:px-5">
              <span className="text-[11px] text-muted-foreground">
                {tf.label}
                {candles.length > 0 && ` · ${candles.length.toLocaleString("en-IN")} bars`}
                {candleSource && ` · ${candleSource}`}
              </span>
              <ChartToolbar
                onToolSelect={setSelectedTool}
                onToggleFullscreen={() => toggleFullscreen()}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onResetZoom={handleResetZoom}
                selectedTool={selectedTool}
                fullscreen={isFullscreen}
              />
            </div>

            {candleQuery.isLoading ? (
              <p className="px-3 py-16 text-center text-xs text-muted-foreground lg:px-5">Loading {tf.label.toLowerCase()} candles…</p>
            ) : candleQuery.isError ? (
              <p role="status" className="px-3 py-16 text-center text-xs text-muted-foreground lg:px-5">
                Candles for {symbol} are unavailable right now. Try another period or refresh.
              </p>
            ) : candles.length === 0 ? (
              <p className="px-3 py-16 text-center text-xs text-muted-foreground lg:px-5">No {tf.label.toLowerCase()} history for {symbol}.</p>
            ) : (
              <div className="p-2 lg:p-3">
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

          {/* Sidebar */}
          <aside className="w-full border-t border-border text-sm lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
            {lastBar && (
              <section className="border-b border-border p-3">
                <h2 className="mb-2 text-xs font-semibold text-muted-foreground">Last bar</h2>
                {([
                  ["Open", lastBar.o.toLocaleString("en-IN", PRICE_FORMAT)],
                  ["High", lastBar.h.toLocaleString("en-IN", PRICE_FORMAT)],
                  ["Low", lastBar.l.toLocaleString("en-IN", PRICE_FORMAT)],
                  ["Close", lastBar.c.toLocaleString("en-IN", PRICE_FORMAT)],
                  ["Volume", lastBar.v.toLocaleString("en-IN")],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono tabular-nums">{value}</span>
                  </div>
                ))}
              </section>
            )}

            <section className="border-b border-border p-3">
              <h2 className="mb-2 text-xs font-semibold text-muted-foreground">Indicators</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ["volume", "Volume", showVolume],
                  ["ma", "Moving avg", showMA],
                  ["rsi", "RSI", showRSI],
                  ["macd", "MACD", showMACD],
                ] as const).map(([key, name, enabled]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={enabled}
                    onClick={() => updateIndicator(key, !enabled)}
                    className={`rounded border px-2 py-1.5 text-left text-xs ${
                      enabled ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            <section className="p-3">
              <h2 className="mb-2 text-xs font-semibold text-muted-foreground">Layout</h2>
              <div className="grid grid-cols-3 gap-1.5">
                <button type="button" onClick={() => toggleLayoutPanel("save")} aria-expanded={layoutPanel === "save"} className={SIDE_BUTTON}>
                  Save
                </button>
                <button type="button" onClick={() => toggleLayoutPanel("load")} aria-expanded={layoutPanel === "load"} className={SIDE_BUTTON}>
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetLayout();
                    setChartState(DEFAULT_CHART_STATE);
                  }}
                  className={SIDE_BUTTON}
                >
                  Reset
                </button>
              </div>
              {layoutPanel === "save" && (
                <form onSubmit={handleSaveLayout} className="mt-2 flex gap-1.5">
                  <input
                    value={layoutName}
                    onChange={(event) => setLayoutName(event.target.value)}
                    placeholder="Layout name"
                    aria-label="Layout name"
                    maxLength={60}
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!layoutName.trim()}
                    className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                </form>
              )}
              {layoutPanel === "load" && (
                namedLayoutNames.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No saved layouts for {symbol}.</p>
                ) : (
                  <ul className="mt-2 space-y-0.5">
                    {namedLayoutNames.map((name) => (
                      <li key={name} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleLoadLayout(name)}
                          className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-accent/50"
                        >
                          {name}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNamedLayout(name)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          aria-label={`Delete layout ${name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {layoutMessage && (
                <p role="status" className="mt-2 text-xs text-muted-foreground">
                  {layoutMessage}
                </p>
              )}
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => exportLayout(chartState)}
                  className={`${SIDE_BUTTON} flex items-center justify-center gap-1`}
                  title="Export layout to JSON"
                >
                  <Download className="h-3 w-3" />
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${SIDE_BUTTON} flex items-center justify-center gap-1`}
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
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
