import { useMemo } from "react";
import type { MarketCandle } from "@/lib/market-api";

export function MiniCandlestickChart({
  candles,
  height = 220,
}: {
  candles: MarketCandle[];
  height?: number;
}) {
  const visible = useMemo(() => candles.slice(-72), [candles]);

  if (visible.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        Waiting for market history…
      </div>
    );
  }

  const lowest = Math.min(...visible.map((candle) => candle.low));
  const highest = Math.max(...visible.map((candle) => candle.high));
  const range = highest - lowest || 1;
  const candleWidth = 100 / visible.length;
  const y = (value: number) => 96 - ((value - lowest) / range) * 90;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-label="Candlestick price chart"
      role="img"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <line
          key={index}
          x1="0"
          x2="100"
          y1={index * 20}
          y2={index * 20}
          stroke="var(--color-grid)"
          strokeWidth="0.18"
        />
      ))}
      {visible.map((candle, index) => {
        const bullish = candle.close >= candle.open;
        const color = bullish ? "var(--color-bull-candle)" : "var(--color-bear-candle)";
        const x = index * candleWidth + candleWidth / 2;
        const openY = y(candle.open);
        const closeY = y(candle.close);
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(0.65, Math.abs(closeY - openY));
        return (
          <g key={`${candle.ts}-${index}`}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="0.25" />
            <rect
              x={x - candleWidth * 0.31}
              y={bodyY}
              width={Math.max(0.5, candleWidth * 0.62)}
              height={bodyHeight}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
