import type { ChartDrawing, IndicatorInstance } from "@shared/research/contracts";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartEngineAdapter {
  setCandles(candles: Candle[]): void;
  setChartType(type: "CANDLE" | "LINE"): void;
  setVisibleRange(range: { start: number; end: number }): void;
  setIndicators(indicators: IndicatorInstance[]): void;
  setDrawings(drawings: ChartDrawing[]): void;
  subscribeCrosshair(handler: (point: { time: number; price: number } | null) => void): () => void;
  exportImage(): Promise<Blob | null>;
  destroy(): void;
}
