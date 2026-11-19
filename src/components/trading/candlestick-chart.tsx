/**
 * CandlestickChart
 *
 * Backwards-compatible wrapper around MAET's high-performance
 * LightweightChart engine. Integrates canonical indicator calculations,
 * trade marker overlays, paper-trading position/SL/TP lines, and smooth
 * canvas-rendered interactions.
 */

import {
  LightweightChart,
  type ChartCandle,
  type DrawingLine,
  type ChartState,
  type ChartIndicatorConfig,
  type TradeMarkerData,
  type PaperOverlayState,
} from "./lightweight-chart";
import type { PlacedCorporateActions } from "./chart-corporate-actions";

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
  /** What the chart shows (symbol, period, bar size), read out in place of the canvas. */
  ariaLabel: string;
  height?: number;
  chartState?: ChartState;
  onChartStateChange?: (state: ChartState) => void;
  drawingTool?: string | null;
  indicators?: ChartIndicatorConfig;
  seriesType?: "candlestick" | "line" | "area";
  trades?: TradeMarkerData[];
  paperOverlay?: PaperOverlayState | null;
  corporateActions?: PlacedCorporateActions[];
  className?: string;
}

export function CandlestickChart({
  data,
  ariaLabel,
  height = 420,
  chartState,
  onChartStateChange,
  drawingTool = null,
  indicators = { sma: false, ema: false, rsi: false, macd: false, volume: true },
  seriesType = "candlestick",
  trades,
  paperOverlay,
  corporateActions,
  className = "",
}: CandlestickChartProps) {
  return (
    <LightweightChart
      data={data}
      ariaLabel={ariaLabel}
      height={height}
      seriesType={seriesType}
      chartState={chartState}
      onChartStateChange={onChartStateChange}
      drawingTool={drawingTool}
      indicators={indicators}
      trades={trades}
      paperOverlay={paperOverlay ?? undefined}
      corporateActions={corporateActions}
      className={className}
    />
  );
}
