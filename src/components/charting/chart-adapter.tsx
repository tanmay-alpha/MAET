import { useMemo } from "react";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import type { ChartDrawing, IndicatorInstance } from "@shared/research/contracts";

export interface ChartAdapterProps {
  data: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  height?: number;
  chartType?: "CANDLE" | "LINE";
  indicators?: IndicatorInstance[];
  drawings?: ChartDrawing[];
  drawingTool?: string | null;
  onDrawingsChange?: (drawings: ChartDrawing[]) => void;
  onSelectPriceAlert?: (price: number) => void;
}

export function ChartAdapter({
  data,
  height = 420,
  chartType = "CANDLE",
  indicators = [],
  drawings = [],
  drawingTool = null,
  onDrawingsChange,
  onSelectPriceAlert,
}: ChartAdapterProps) {
  const chartIndicators = useMemo(() => {
    return {
      sma: indicators.some((i) => i.type === "SMA" && i.visible),
      ema: indicators.some((i) => i.type === "EMA" && i.visible),
      rsi: indicators.some((i) => i.type === "RSI" && i.visible),
      macd: indicators.some((i) => i.type === "MACD" && i.visible),
      volume: indicators.some((i) => i.type === "VOLUME" && i.visible),
    };
  }, [indicators]);

  const convertedDrawings = useMemo(() => {
    return drawings.map((d) => ({
      id: d.id,
      type: (d.drawingType.toLowerCase().replace("_line", "").replace("_", "-")) as any,
      points: d.points.map((p) => ({ x: p.x || 0, y: p.y || 0, price: p.price, time: p.time })),
      color: d.style?.color || "var(--color-primary)",
      visible: d.visible,
    }));
  }, [drawings]);

  return (
    <CandlestickChart
      data={data}
      height={height}
      chartState={{
        zoom: 1,
        panOffset: 0,
        drawings: convertedDrawings,
      }}
      onChartStateChange={() => {}}
      drawingTool={drawingTool}
      indicators={chartIndicators}
    />
  );
}
