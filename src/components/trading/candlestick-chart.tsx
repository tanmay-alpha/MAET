/**
 * CandlestickChart & CandlestickChartSimple
 *
 * Backwards-compatible wrapper around MAET's high-performance
 * LightweightChart engine. Integrates canonical indicator calculations,
 * trade marker overlays, paper-trading position/SL/TP lines, and smooth
 * canvas-rendered interactions.
 */

import React from "react";
import {
  LightweightChart,
  type ChartCandle,
  type DrawingLine,
  type ChartState,
  type ChartIndicatorConfig,
  type TradeMarkerData,
  type PaperOverlayState,
} from "./lightweight-chart";

export type Candle = ChartCandle;
export type {
  DrawingLine,
  ChartState,
  ChartIndicatorConfig,
  TradeMarkerData,
  PaperOverlayState,
};

export interface CandlestickChartProps {
  data: Candle[];
  height?: number;
  chartState?: ChartState;
  onChartStateChange?: (state: ChartState) => void;
  drawingTool?: string | null;
  indicators?: ChartIndicatorConfig;
  seriesType?: "candlestick" | "line" | "area";
  trades?: TradeMarkerData[];
  paperOverlay?: PaperOverlayState | null;
  className?: string;
}

export function CandlestickChart({
  data,
  height = 420,
  chartState,
  onChartStateChange,
  drawingTool = null,
  indicators = { sma: false, ema: false, rsi: false, macd: false, volume: true },
  seriesType = "candlestick",
  trades = [],
  paperOverlay,
  className = "",
}: CandlestickChartProps) {
  return (
    <LightweightChart
      data={data}
      height={height}
      seriesType={seriesType}
      chartState={chartState}
      onChartStateChange={onChartStateChange}
      drawingTool={drawingTool}
      indicators={indicators}
      trades={trades}
      paperOverlay={paperOverlay ?? undefined}
      className={className}
    />
  );
}

/**
 * Simplified candlestick chart without drawing controls or complex panels.
 */
export function CandlestickChartSimple({
  data,
  height = 420,
  className = "",
}: {
  data: Candle[];
  height?: number;
  className?: string;
}) {
  return (
    <LightweightChart
      data={data}
      height={height}
      indicators={{ volume: true, sma: false, ema: false, rsi: false, macd: false }}
      className={className}
    />
  );
}
