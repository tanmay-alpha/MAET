/**
 * MAET High-Performance Terminal Chart
 * Built on TradingView Lightweight Charts v5 with canonical indicator integration,
 * trade markers overlay, and paper trading position lines.
 */

import React, { useEffect, useRef, useMemo, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { computeSMA, computeEMA, computeRSI, computeMACD } from "@shared/indicators";

export interface ChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface DrawingLine {
  id: string;
  type: "trendline" | "horizontal" | "vertical" | "fibonacci" | "support-resistance";
  points: { x: number; y: number; price: number; time: number }[];
  color: string;
  visible: boolean;
}

export interface ChartState {
  zoom: number;
  panOffset: number;
  drawings: DrawingLine[];
}

export interface ChartIndicatorConfig {
  sma?: boolean;
  ema?: boolean;
  rsi?: boolean;
  macd?: boolean;
  volume?: boolean;
}

export interface TradeMarkerData {
  id: string;
  time: number;
  side: "buy" | "sell" | "exit";
  price: number;
  qty?: number;
  pnl?: number;
  text?: string;
}

export interface PaperOverlayState {
  averageEntryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL?: number;
  side?: "LONG" | "SHORT";
}

export interface LightweightChartProps {
  data: ChartCandle[];
  height?: number;
  seriesType?: "candlestick" | "line" | "area";
  chartState?: ChartState;
  onChartStateChange?: (state: ChartState) => void;
  drawingTool?: string | null;
  indicators?: ChartIndicatorConfig;
  trades?: TradeMarkerData[];
  paperOverlay?: PaperOverlayState;
  className?: string;
}

// Convert timestamp (ms or s) to UTC seconds for Lightweight Charts
function toSeconds(ts: number): number {
  return ts > 1e11 ? Math.floor(ts / 1000) : ts;
}

// Format currency for price scales
function formatInr(price: number): string {
  return `₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function LightweightChart({
  data,
  height = 480,
  seriesType = "candlestick",
  chartState,
  onChartStateChange,
  drawingTool = null,
  indicators = { sma: false, ema: false, rsi: false, macd: false, volume: true },
  trades = [],
  paperOverlay,
  className = "",
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<any>(null);

  // Price lines for paper trading & horizontal drawing
  const paperLinesRef = useRef<IPriceLine[]>([]);
  const drawingPriceLinesRef = useRef<IPriceLine[]>([]);

  // RSI series refs
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Sanitize and sort candle data
  const sanitizedCandles = useMemo(() => {
    if (!data || data.length === 0) return [];
    const sorted = [...data].sort((a, b) => a.t - b.t);
    const seenTimes = new Set<number>();
    const result: Array<{
      time: Time;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    for (const c of sorted) {
      const sec = toSeconds(c.t);
      if (!seenTimes.has(sec)) {
        seenTimes.add(sec);
        result.push({
          time: sec as Time,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
          volume: c.v || 0,
        });
      }
    }
    return result;
  }, [data]);

  // Initialize main chart
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const chartHeight = indicators.rsi ? Math.max(height - 120, 260) : height;

    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(30, 41, 59, 0.45)" },
        horzLines: { color: "rgba(30, 41, 59, 0.45)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(148, 163, 184, 0.5)",
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: "rgba(148, 163, 184, 0.5)",
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      timeScale: {
        borderColor: "rgba(51, 65, 85, 0.6)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(51, 65, 85, 0.6)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
    });

    chartRef.current = chart;

    // Create main price series
    let mainSeries: ISeriesApi<any>;
    if (seriesType === "line") {
      mainSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 2,
      });
    } else if (seriesType === "area") {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: "rgba(59, 130, 246, 0.4)",
        bottomColor: "rgba(59, 130, 246, 0.0)",
        lineColor: "#3b82f6",
        lineWidth: 2,
      });
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
    }
    mainSeriesRef.current = mainSeries;

    // Create volume overlay series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(148, 163, 184, 0.3)",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Create SMA series lines
    sma20SeriesRef.current = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 1,
      title: "SMA 20",
    });
    sma50SeriesRef.current = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 1,
      title: "SMA 50",
    });
    sma200SeriesRef.current = chart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      title: "SMA 200",
    });

    // Create EMA series lines
    ema20SeriesRef.current = chart.addSeries(LineSeries, {
      color: "#06b6d4",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: "EMA 20",
    });
    ema50SeriesRef.current = chart.addSeries(LineSeries, {
      color: "#eab308",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: "EMA 50",
    });

    // Responsive resize handler
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container && chartRef.current) {
          const newWidth = entry.contentRect.width;
          const newHeight = indicators.rsi ? Math.max(height - 120, 260) : height;
          chartRef.current.resize(newWidth, newHeight);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [seriesType, height, indicators.rsi]);

  // Initialize RSI sub-chart
  useEffect(() => {
    if (!indicators.rsi || !rsiContainerRef.current) {
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
      return;
    }

    const rsiContainer = rsiContainerRef.current;
    const rsiChart = createChart(rsiContainer, {
      width: rsiContainer.clientWidth || 800,
      height: 120,
      layout: {
        background: { type: ColorType.Solid, color: "#090d13" },
        textColor: "#94a3b8",
        fontSize: 10,
        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(30, 41, 59, 0.3)" },
        horzLines: { color: "rgba(30, 41, 59, 0.3)" },
      },
      timeScale: {
        borderColor: "rgba(51, 65, 85, 0.5)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(51, 65, 85, 0.5)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      title: "RSI 14",
    });

    // Reference lines for Overbought (70) and Oversold (30)
    rsiSeries.createPriceLine({
      price: 70,
      color: "rgba(239, 68, 68, 0.6)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "70 OB",
    });
    rsiSeries.createPriceLine({
      price: 30,
      color: "rgba(34, 197, 94, 0.6)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "30 OS",
    });

    rsiChartRef.current = rsiChart;
    rsiSeriesRef.current = rsiSeries;

    // Sync time scale with main chart
    if (chartRef.current) {
      const mainTimeScale = chartRef.current.timeScale();
      const rsiTimeScale = rsiChart.timeScale();

      mainTimeScale.subscribeVisibleTimeRangeChange((timeRange) => {
        if (timeRange) rsiTimeScale.setVisibleRange(timeRange);
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === rsiContainer && rsiChartRef.current) {
          rsiChartRef.current.resize(entry.contentRect.width, 120);
        }
      }
    });
    resizeObserver.observe(rsiContainer);

    return () => {
      resizeObserver.disconnect();
      rsiChart.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    };
  }, [indicators.rsi]);

  // Update data & indicators
  useEffect(() => {
    if (!mainSeriesRef.current || sanitizedCandles.length === 0) return;

    // 1. Set main series data
    if (seriesType === "candlestick") {
      mainSeriesRef.current.setData(
        sanitizedCandles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else {
      mainSeriesRef.current.setData(
        sanitizedCandles.map((c) => ({
          time: c.time,
          value: c.close,
        })),
      );
    }

    // 2. Set volume series data
    if (volumeSeriesRef.current) {
      if (indicators.volume !== false) {
        volumeSeriesRef.current.setData(
          sanitizedCandles.map((c) => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)",
          })),
        );
      } else {
        volumeSeriesRef.current.setData([]);
      }
    }

    // 3. Calculate canonical SMAs and EMAs
    if (sanitizedCandles.length > 0) {
      if (
        indicators.sma &&
        sma20SeriesRef.current &&
        sma50SeriesRef.current &&
        sma200SeriesRef.current
      ) {
        const sma20 = computeSMA(sanitizedCandles, 20);
        const sma50 = computeSMA(sanitizedCandles, 50);
        const sma200 = computeSMA(sanitizedCandles, 200);

        sma20SeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: sma20[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
        sma50SeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: sma50[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
        sma200SeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: sma200[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
      } else {
        sma20SeriesRef.current?.setData([]);
        sma50SeriesRef.current?.setData([]);
        sma200SeriesRef.current?.setData([]);
      }

      if (indicators.ema && ema20SeriesRef.current && ema50SeriesRef.current) {
        const ema20 = computeEMA(sanitizedCandles, 20);
        const ema50 = computeEMA(sanitizedCandles, 50);

        ema20SeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: ema20[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
        ema50SeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: ema50[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
      } else {
        ema20SeriesRef.current?.setData([]);
        ema50SeriesRef.current?.setData([]);
      }

      // 4. Calculate canonical RSI
      if (indicators.rsi && rsiSeriesRef.current) {
        const rsi14 = computeRSI(sanitizedCandles, 14);
        rsiSeriesRef.current.setData(
          sanitizedCandles
            .map((c, i) => ({ time: c.time, value: rsi14[i] }))
            .filter((p): p is { time: Time; value: number } => p.value !== null),
        );
      }
    }

    // 5. Fit content on initial load
    chartRef.current?.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();
  }, [sanitizedCandles, seriesType, indicators]);

  // Update trade markers (backtest & execution fills)
  useEffect(() => {
    if (!mainSeriesRef.current) return;

    if (trades.length === 0) {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
      return;
    }

    const seriesMarkers: SeriesMarker<Time>[] = trades.map((tr) => {
      const time = toSeconds(tr.time) as Time;
      if (tr.side === "buy") {
        return {
          time,
          position: "belowBar",
          color: "#22c55e",
          shape: "arrowUp",
          text: tr.text || `BUY @ ${tr.price}`,
        };
      } else if (tr.side === "sell") {
        return {
          time,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: tr.text || `SELL @ ${tr.price}`,
        };
      } else {
        return {
          time,
          position: "aboveBar",
          color: tr.pnl && tr.pnl >= 0 ? "#22c55e" : "#ef4444",
          shape: "circle",
          text:
            tr.text ||
            (tr.pnl !== undefined
              ? `EXIT (${tr.pnl >= 0 ? "+" : ""}${tr.pnl.toFixed(1)})`
              : "EXIT"),
        };
      }
    });

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(mainSeriesRef.current, seriesMarkers);
    } else {
      markersPluginRef.current.setMarkers(seriesMarkers);
    }
  }, [trades]);

  // Update paper trading price lines (avg entry, SL, TP)
  useEffect(() => {
    const mainSeries = mainSeriesRef.current;
    if (!mainSeries) return;

    // Remove existing paper lines
    for (const line of paperLinesRef.current) {
      try {
        mainSeries.removePriceLine(line);
      } catch {
        // Price line already removed or detached
      }
    }
    paperLinesRef.current = [];

    if (!paperOverlay) return;

    const newLines: IPriceLine[] = [];

    // 1. Average Entry Price Line
    if (paperOverlay.averageEntryPrice) {
      const entryLine = mainSeries.createPriceLine({
        price: paperOverlay.averageEntryPrice,
        color: "#3b82f6",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `POS ${paperOverlay.side || ""} @ ${formatInr(paperOverlay.averageEntryPrice)}`,
      });
      newLines.push(entryLine);
    }

    // 2. Take Profit Line
    if (paperOverlay.takeProfit) {
      const tpLine = mainSeries.createPriceLine({
        price: paperOverlay.takeProfit,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `TP @ ${formatInr(paperOverlay.takeProfit)}`,
      });
      newLines.push(tpLine);
    }

    // 3. Stop Loss Line
    if (paperOverlay.stopLoss) {
      const slLine = mainSeries.createPriceLine({
        price: paperOverlay.stopLoss,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `SL @ ${formatInr(paperOverlay.stopLoss)}`,
      });
      newLines.push(slLine);
    }

    paperLinesRef.current = newLines;
  }, [paperOverlay]);

  // Render horizontal drawing tools if active
  useEffect(() => {
    const mainSeries = mainSeriesRef.current;
    if (!mainSeries) return;

    // Remove old drawing price lines
    for (const line of drawingPriceLinesRef.current) {
      try {
        mainSeries.removePriceLine(line);
      } catch {
        // Price line already removed or detached
      }
    }
    drawingPriceLinesRef.current = [];

    if (!chartState?.drawings) return;

    const newLines: IPriceLine[] = [];
    for (const d of chartState.drawings) {
      if (d.visible && d.type === "horizontal" && d.points.length > 0) {
        const line = mainSeries.createPriceLine({
          price: d.points[0].price,
          color: d.color || "#eab308",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `HL ${formatInr(d.points[0].price)}`,
        });
        newLines.push(line);
      }
    }
    drawingPriceLinesRef.current = newLines;
  }, [chartState?.drawings]);

  // Click on chart for drawing
  const handleChartClick = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingTool || !containerRef.current || !mainSeriesRef.current || !chartRef.current)
        return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chartRef.current.timeScale().coordinateToTime(x);
      const price = mainSeriesRef.current.coordinateToPrice(y);

      if (time !== null && price !== null) {
        const newDrawing: DrawingLine = {
          id: `draw-${Date.now()}`,
          type: drawingTool === "horizontal" ? "horizontal" : "trendline",
          points: [{ x, y, price, time: Number(time) }],
          color: "#38bdf8",
          visible: true,
        };

        const nextDrawings = [...(chartState?.drawings || []), newDrawing];
        onChartStateChange?.({
          zoom: chartState?.zoom ?? 1,
          panOffset: chartState?.panOffset ?? 0,
          drawings: nextDrawings,
        });
      }
    },
    [drawingTool, chartState, onChartStateChange],
  );

  return (
    <div
      className={`relative flex flex-col w-full bg-[#0d1117] rounded-lg overflow-hidden border border-border/60 ${className}`}
    >
      {/* Main Chart Container */}
      <div
        ref={containerRef}
        onClick={handleChartClick}
        className="w-full relative cursor-crosshair"
        style={{ height: indicators.rsi ? Math.max(height - 120, 260) : height }}
      />

      {/* RSI Sub-pane Container */}
      {indicators.rsi && (
        <div className="w-full border-t border-border/50 bg-[#090d13] relative">
          <div className="absolute top-1 left-2 z-10 text-[10px] font-mono text-muted-foreground flex items-center gap-2 pointer-events-none">
            <span className="text-purple-400 font-semibold">RSI(14)</span>
            <span>Wilder&apos;s Canonical</span>
          </div>
          <div ref={rsiContainerRef} className="w-full h-[120px]" />
        </div>
      )}

      {/* Floating Indicator Badges */}
      <div className="absolute top-2 left-3 z-10 flex items-center gap-2 pointer-events-none text-[11px] font-mono">
        {indicators.sma && (
          <div className="flex items-center gap-2 bg-background/80 backdrop-blur px-2 py-0.5 rounded border border-border/40 text-[10px]">
            <span className="text-blue-400 font-medium">SMA 20</span>
            <span className="text-orange-400 font-medium">SMA 50</span>
            <span className="text-purple-400 font-medium">SMA 200</span>
          </div>
        )}
        {indicators.ema && (
          <div className="flex items-center gap-2 bg-background/80 backdrop-blur px-2 py-0.5 rounded border border-border/40 text-[10px]">
            <span className="text-cyan-400 font-medium">EMA 20</span>
            <span className="text-yellow-400 font-medium">EMA 50</span>
          </div>
        )}
        {paperOverlay?.averageEntryPrice && (
          <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded text-[10px] font-semibold">
            <span>
              POS: {paperOverlay.side} @ {formatInr(paperOverlay.averageEntryPrice)}
            </span>
            {paperOverlay.unrealizedPnL !== undefined && (
              <span className={paperOverlay.unrealizedPnL >= 0 ? "text-bull" : "text-bear"}>
                ({paperOverlay.unrealizedPnL >= 0 ? "+" : ""}
                {formatInr(paperOverlay.unrealizedPnL)})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
