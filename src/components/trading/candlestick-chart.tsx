import { useMemo, useRef, useState, useEffect, useCallback, type MouseEvent, type TouchEvent } from "react";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type Hover = { idx: number; px: number; py: number; price: number; innerW: number };

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
  sma: boolean;
  ema: boolean;
  rsi: boolean;
  macd: boolean;
  volume: boolean;
}

const DEFAULT_CHART_STATE: ChartState = {
  zoom: 1,
  panOffset: 0,
  drawings: []
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = [
  "#ef4444", // 0% - red
  "#f97316", // 23.6% - orange
  "#eab308", // 38.2% - yellow
  "#22c55e", // 50% - green
  "#3b82f6", // 61.8% - blue
  "#8b5cf6", // 78.6% - purple
  "#ec4899"  // 100% - pink
];

interface CandlestickChartProps {
  data: Candle[];
  height?: number;
  chartState: ChartState;
  onChartStateChange: (state: ChartState) => void;
  drawingTool: string | null;
  indicators?: ChartIndicatorConfig;
}

export function CandlestickChart({
  data,
  height = 420,
  chartState,
  onChartStateChange,
  drawingTool,
  indicators = { sma: false, ema: false, rsi: false, macd: false, volume: true }
}: CandlestickChartProps) {
  // Indicator visibility is controlled by the parent. Keeping this derived from
  // props avoids the stale copied-state bug when toolbar toggles change.
  const showSMA = indicators.sma;
  const showEMA = indicators.ema;
  const showRSI = indicators.rsi;
  const showMACD = indicators.macd;
  const showVolume = indicators.volume;

  // Indicator calculations
  const indicatorData = useMemo(() => {
    if (data.length < 2) return null;

    const closes = data.map(d => d.c);
    const volumes = data.map(d => d.v);

    // SMA calculation
    const calculateSMA = (period: number) => {
      const result: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += closes[i - j];
        result.push(sum / period);
      }
      return result;
    };

    // EMA calculation
    const calculateEMA = (period: number) => {
      const result: number[] = [];
      const multiplier = 2 / (period + 1);
      let ema = NaN;
      for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        if (isNaN(ema)) { let sum = 0; for (let j = 0; j < period; j++) sum += closes[i - j]; ema = sum / period; }
        else ema = (closes[i] - ema) * multiplier + ema;
        result.push(ema);
      }
      return result;
    };

    // RSI calculation
    const calculateRSI = (period: number = 14) => {
      const result: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        if (i < period) { result.push(NaN); continue; }
        let gains = 0, losses = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const change = closes[j] - closes[j - 1];
          if (change > 0) gains += change; else losses -= change;
        }
        const avgGain = gains / period, avgLoss = losses / period;
        result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      }
      return result;
    };

    // Helper for EMA of a filtered array
    const calculateEMA2 = (arr: number[], period: number): number[] => {
      const multiplier = 2 / (period + 1);
      const result: number[] = [];
      let ema = NaN;
      for (let i = 0; i < arr.length; i++) {
        if (isNaN(arr[i])) { result.push(NaN); continue; }
        if (isNaN(ema)) ema = arr[i];
        else ema = (arr[i] - ema) * multiplier + ema;
        result.push(ema);
      }
      return result;
    };

    const ema12 = calculateEMA(12);
    const ema26 = calculateEMA(26);
    const macdLine = ema12.map((v, i) => (isNaN(v) || isNaN(ema26[i])) ? NaN : v - ema26[i]);
    const validMacd = macdLine.filter(v => !isNaN(v));
    const signalLine = calculateEMA2(validMacd, 9);
    let sigIdx = 0;
    const signal = macdLine.map(v => isNaN(v) ? NaN : signalLine[sigIdx++] ?? NaN);
    const histogram = macdLine.map((m, i) => (isNaN(m) || isNaN(signal[i])) ? NaN : m - signal[i]);

    // Volume max for scaling
    const maxVol = Math.max(...volumes);

    return {
      sma20: calculateSMA(20),
      ema20: calculateEMA(20),
      rsi: calculateRSI(14),
      macd: { line: macdLine, signal, histogram },
      maxVol
    };
  }, [data]);

  const { min, max, candleW } = useMemo(() => {
    const min = Math.min(...data.map((d) => d.l));
    const max = Math.max(...data.map((d) => d.h));
    const zoomFactor = chartState.zoom;
    const visibleCandles = Math.floor(data.length / zoomFactor);
    return { min, max, candleW: (100 / data.length) * zoomFactor };
  }, [data, chartState.zoom]);

  const pad = (max - min) * 0.05;
  const lo = min - pad;
  const hi = max + pad;
  const range = hi - lo;

  const y = useCallback((v: number) => ((hi - v) / range) * 100, [hi, range]);
  const priceToY = useCallback((price: number) => ((hi - price) / range) * height, [hi, range, height]);
  const yToPrice = useCallback((yPos: number) => hi - (yPos / height) * range, [hi, range, height]);

  const gridLines = 6;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [visible, setVisible] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number; price: number; time: number }[]>([]);
  const [startDrawingPos, setStartDrawingPos] = useState<{ x: number; y: number } | null>(null);

  // Smooth fade-out
  useEffect(() => {
    if (hover) setVisible(true);
  }, [hover]);

  const getVisibleDataRange = useCallback(() => {
    const start = Math.max(0, data.length - Math.floor(data.length * chartState.zoom));
    const end = data.length;
    return { start, end };
  }, [data.length, chartState.zoom]);

  function pointToHover(clientX: number, clientY: number): Hover | null {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const innerW = r.width - 56;
    const x = Math.max(0, Math.min(innerW, clientX - r.left));
    const yPx = Math.max(0, Math.min(r.height, clientY - r.top));
    const { start, end } = getVisibleDataRange();
    const visibleCount = end - start;
    const idx = Math.max(0, Math.min(data.length - 1, Math.floor((x / innerW) * visibleCount) + start));
    const price = yToPrice(yPx);
    return { idx, px: x, py: yPx, price, innerW };
  }

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (isDrawing && startDrawingPos) {
      const h = pointToHover(e.clientX, e.clientY);
      if (h) {
        const price = yToPrice(h.py);
        const candleIdx = h.idx;
        const time = data[candleIdx]?.t || Date.now();
        setDrawingPoints([
          drawingPoints[0],
          { x: h.px, y: h.py, price, time }
        ]);
      }
      return;
    }

    const h = pointToHover(e.clientX, e.clientY);
    if (h) setHover(h);
  }

  function onLeave() {
    if (isDrawing) {
      finalizeDrawing();
      return;
    }
    setVisible(false);
    window.setTimeout(() => setHover(null), 140);
  }

  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (!drawingTool) return;

    const h = pointToHover(e.clientX, e.clientY);
    if (h) {
      const price = yToPrice(h.py);
      const time = data[h.idx]?.t || Date.now();
      setStartDrawingPos({ x: h.px, y: h.py });
      setDrawingPoints([{ x: h.px, y: h.py, price, time }]);
      setIsDrawing(true);
    }
  }

  function onMouseUp(e: MouseEvent<HTMLDivElement>) {
    if (!isDrawing) return;

    const h = pointToHover(e.clientX, e.clientY);
    if (h) {
      const price = yToPrice(h.py);
      const time = data[h.idx]?.t || Date.now();
      const newPoints = [...drawingPoints, { x: h.px, y: h.py, price, time }];
      setDrawingPoints(newPoints);

      if (newPoints.length >= 2) {
        finalizeDrawingWithPoints(newPoints);
      }
    }

    setIsDrawing(false);
    setStartDrawingPos(null);
    setDrawingPoints([]);
  }

  function finalizeDrawing() {
    if (drawingPoints.length >= 2) {
      finalizeDrawingWithPoints(drawingPoints);
    }
    setIsDrawing(false);
    setStartDrawingPos(null);
    setDrawingPoints([]);
  }

  function finalizeDrawingWithPoints(points: { x: number; y: number; price: number; time: number }[]) {
    const drawingType = getDrawingType(drawingTool);
    if (!drawingType) return;

    const newDrawing: DrawingLine = {
      id: `${drawingType}-${Date.now()}`,
      type: drawingType,
      points,
      color: getDrawingColor(drawingType),
      visible: true
    };

    onChartStateChange({
      ...chartState,
      drawings: [...chartState.drawings, newDrawing]
    });
  }

  function getDrawingType(tool: string | null): DrawingLine["type"] | null {
    switch (tool) {
      case "trend": return "trendline";
      case "horizontal": return "horizontal";
      case "vertical": return "vertical";
      case "fibonacci": return "fibonacci";
      case "support": return "support-resistance";
      default: return null;
    }
  }

  function getDrawingColor(type: DrawingLine["type"]): string {
    switch (type) {
      case "trendline": return "#3b82f6";
      case "horizontal": return "#22c55e";
      case "vertical": return "#f97316";
      case "fibonacci": return "#8b5cf6";
      case "support-resistance": return "#ef4444";
      default: return "#6b7280";
    }
  }

  function onTouch(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const h = pointToHover(t.clientX, t.clientY);
    if (h) setHover(h);
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd() {
    if (isDrawing) {
      finalizeDrawing();
      return;
    }
    setVisible(false);
    window.setTimeout(() => setHover(null), 220);
  }

  // Delete drawing
  function deleteDrawing(id: string) {
    onChartStateChange({
      ...chartState,
      drawings: chartState.drawings.filter(d => d.id !== id)
    });
  }

  const c = hover ? data[hover.idx] : null;
  const tooltipW = 168;
  const tooltipH = 110;
  const innerW = hover ? hover.innerW : (wrapRef.current ? wrapRef.current.clientWidth - 56 : 0);
  const preferRight = hover ? hover.px + tooltipW + 20 < innerW : true;
  const tooltipLeft = hover
    ? preferRight
      ? Math.min(hover.px + 14, innerW - tooltipW - 6)
      : Math.max(6, hover.px - tooltipW - 14)
    : 0;
  const tooltipTop = hover
    ? Math.max(6, Math.min(height - tooltipH - 6, hover.py - tooltipH / 2))
    : 0;

  const { start: visibleStart, end: visibleEnd } = getVisibleDataRange();
  const visibleData = data.slice(visibleStart, visibleEnd);
  const visibleCandleW = (100 / Math.max(1, visibleData.length)) * chartState.zoom;

  return (
    <div
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className={`relative w-full cursor-crosshair touch-none bg-background select-none ${
        drawingTool ? "cursor-crosshair" : "cursor-default"
      }`}
      style={{ height }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-0 h-full"
        style={{ width: "calc(100% - 56px)" }}
      >
        {/* Grid lines */}
        {Array.from({ length: gridLines }).map((_, i) => (
          <line
            key={`grid-${i}`}
            x1="0" x2="100"
            y1={(i / (gridLines - 1)) * 100}
            y2={(i / (gridLines - 1)) * 100}
            stroke="var(--color-grid)"
            strokeWidth="0.1"
          />
        ))}

        {/* Drawings */}
        {chartState.drawings.map((drawing) => (
          <g key={drawing.id}>
            {drawing.type === "horizontal" && drawing.points.length >= 2 && (
              <>
                <line
                  x1="0" x2="100"
                  y1={y(drawing.points[0].price)}
                  y2={y(drawing.points[0].price)}
                  stroke={drawing.color}
                  strokeWidth="0.15"
                  strokeDasharray="0.5,0.5"
                />
              </>
            )}
            {drawing.type === "vertical" && drawing.points.length >= 2 && (
              <line
                x1={(drawing.points[0].time - data[0]?.t) / (data[data.length - 1]?.t - data[0]?.t) * 100}
                x2={(drawing.points[0].time - data[0]?.t) / (data[data.length - 1]?.t - data[0]?.t) * 100}
                y1="0" y2="100"
                stroke={drawing.color}
                strokeWidth="0.15"
                strokeDasharray="0.5,0.5"
              />
            )}
            {drawing.type === "trendline" && drawing.points.length >= 2 && (
              <line
                x1={drawing.points[0].x / innerW * 100}
                x2={drawing.points[drawing.points.length - 1].x / innerW * 100}
                y1={y(drawing.points[0].price)}
                y2={y(drawing.points[drawing.points.length - 1].price)}
                stroke={drawing.color}
                strokeWidth="0.2"
              />
            )}
            {drawing.type === "fibonacci" && drawing.points.length >= 2 && (
              <>
                {FIB_LEVELS.map((level, i) => {
                  const yPos = y(drawing.points[0].price + (drawing.points[1].price - drawing.points[0].price) * level);
                  return (
                    <g key={i}>
                      <line
                        x1="0" x2="100"
                        y1={yPos} y2={yPos}
                        stroke={FIB_COLORS[i]}
                        strokeWidth="0.1"
                      />
                      <text
                        x="101"
                        y={yPos}
                        fill={FIB_COLORS[i]}
                        fontSize="1.5"
                        dominantBaseline="middle"
                      >
                        {(level * 100).toFixed(1)}%
                      </text>
                    </g>
                  );
                })}
              </>
            )}
            {drawing.type === "support-resistance" && drawing.points.length >= 2 && (
              <>
                <line
                  x1="0" x2="100"
                  y1={y(Math.min(drawing.points[0].price, drawing.points[1].price))}
                  y2={y(Math.min(drawing.points[0].price, drawing.points[1].price))}
                  stroke="#ef4444"
                  strokeWidth="0.15"
                  strokeDasharray="0.5,0.5"
                />
                <line
                  x1="0" x2="100"
                  y1={y(Math.max(drawing.points[0].price, drawing.points[1].price))}
                  y2={y(Math.max(drawing.points[0].price, drawing.points[1].price))}
                  stroke="#22c55e"
                  strokeWidth="0.15"
                  strokeDasharray="0.5,0.5"
                />
              </>
            )}
          </g>
        ))}

        {/* Current drawing preview */}
        {isDrawing && drawingPoints.length >= 1 && (
          <g>
            <circle
              cx={drawingPoints[0].x / innerW * 100}
              cy={y(drawingPoints[0].price)}
              r="0.5"
              fill={getDrawingColor(getDrawingType(drawingTool) || "trendline")}
            />
            {drawingPoints.length >= 2 && (
              <>
                <line
                  x1={drawingPoints[0].x / innerW * 100}
                  x2={drawingPoints[drawingPoints.length - 1].x / innerW * 100}
                  y1={y(drawingPoints[0].price)}
                  y2={y(drawingPoints[drawingPoints.length - 1].price)}
                  stroke={getDrawingColor(getDrawingType(drawingTool) || "trendline")}
                  strokeWidth="0.2"
                  strokeDasharray="0.5,0.5"
                />
                {drawingTool === "fibonacci" && (
                  <>
                    {FIB_LEVELS.map((level, i) => {
                      const yPos = y(drawingPoints[0].price + (drawingPoints[drawingPoints.length - 1].price - drawingPoints[0].price) * level);
                      return (
                        <line
                          key={i}
                          x1="0" x2="100"
                          y1={yPos} y2={yPos}
                          stroke={FIB_COLORS[i]}
                          strokeWidth="0.1"
                          opacity="0.7"
                        />
                      );
                    })}
                  </>
                )}
              </>
            )}
          </g>
        )}

        {/* Volume Histogram */}
        {showVolume && indicatorData && visibleData.map((c, i) => {
          const x = i * visibleCandleW + visibleCandleW / 2;
          const bull = c.c >= c.o;
          const barW = visibleCandleW * 0.35;
          const volH = indicatorData.maxVol > 0 ? (c.v / indicatorData.maxVol) * 25 : 0;
          const vColor = bull ? "var(--color-bull-bar)" : "var(--color-bear-bar)";
          return (
            <rect key={`vol-${i}`} x={x - barW / 2} y={100 - volH} width={barW} height={volH} fill={vColor} opacity="0.4" />
          );
        })}

        {/* SMA Line */}
        {showSMA && indicatorData && (() => {
          const pts: Array<{x: number, y: number}> = [];
          for (let i = 0; i < data.length; i++) {
            if (!isNaN(indicatorData.sma20[i]) && i >= visibleStart && i < visibleEnd) {
              pts.push({ x: (i - visibleStart) * visibleCandleW + visibleCandleW / 2, y: y(indicatorData.sma20[i]) });
            }
          }
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return <path key="sma-line" d={d} stroke="#f59e0b" strokeWidth="0.15" fill="none" />;
        })()}

        {/* EMA Line */}
        {showEMA && indicatorData && (() => {
          const pts: Array<{x: number, y: number}> = [];
          for (let i = 0; i < data.length; i++) {
            if (!isNaN(indicatorData.ema20[i]) && i >= visibleStart && i < visibleEnd) {
              pts.push({ x: (i - visibleStart) * visibleCandleW + visibleCandleW / 2, y: y(indicatorData.ema20[i]) });
            }
          }
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return <path key="ema-line" d={d} stroke="#06b6d4" strokeWidth="0.15" fill="none" />;
        })()}

        {/* Candlesticks */}
        {visibleData.map((c, i) => {
          const x = i * visibleCandleW + visibleCandleW / 2;
          const bull = c.c >= c.o;
          const color = bull ? "var(--color-bull-candle)" : "var(--color-bear-candle)";
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="0.15" />
              <rect
                x={x - visibleCandleW * 0.35}
                y={y(Math.max(c.o, c.c))}
                width={visibleCandleW * 0.7}
                height={Math.max(0.3, Math.abs(y(c.o) - y(c.c)))}
                fill={color}
              />
            </g>
          );
        })}
      </svg>

      {/* Price axis */}
      <div className="pointer-events-none absolute right-0 top-0 flex h-full w-14 flex-col justify-between border-l border-border bg-panel/60 px-2 py-1 text-tv-legend text-muted-foreground">
        {Array.from({ length: gridLines }).map((_, i) => {
          const v = hi - (i / (gridLines - 1)) * (hi - lo);
          return <div key={i} className="text-right">{v.toFixed(2)}</div>;
        })}
      </div>

      {/* RSI sub-panel */}
      {showRSI && indicatorData && (
        <div
          className="absolute left-0 bottom-0 right-14 h-16 border-t border-border bg-panel/90"
          data-testid="rsi-panel"
          role="img"
          aria-label="RSI 14 indicator panel with 30 and 70 thresholds"
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {/* 30/70 threshold lines */}
            <line x1="0" x2="100" y1="70" y2="70" stroke="var(--color-border)" strokeWidth="0.15" strokeDasharray="0.5,0.5" />
            <line x1="0" x2="100" y1="30" y2="30" stroke="var(--color-border)" strokeWidth="0.15" strokeDasharray="0.5,0.5" />
            {/* RSI line */}
            {(() => {
              const rsiValues = indicatorData.rsi;
              const visibleRSI = rsiValues.slice(visibleStart, visibleEnd);
              const pts: string[] = [];
              let idx = 0;
              for (let i = 0; i < visibleRSI.length; i++) {
                if (isNaN(visibleRSI[i])) continue;
                const x = (idx / Math.max(1, visibleRSI.filter(v => !isNaN(v)).length - 1)) * 100;
                const y = 100 - visibleRSI[i];
                pts.push(`${idx === 0 ? "M" : "L"} ${x} ${y}`);
                idx++;
              }
              return pts.length >= 2 ? <path key="rsi-line" d={pts.join(" ")} stroke="#8b5cf6" strokeWidth="0.25" fill="none" /> : null;
            })()}
          </svg>
          <div className="pointer-events-none absolute right-0 top-0 flex h-full w-14 flex-col justify-between px-2 py-1 text-tv-legend text-muted-foreground">
            <div className="text-right">70</div>
            <div className="text-right">50</div>
            <div className="text-right">30</div>
          </div>
        </div>
      )}

      {/* MACD sub-panel */}
      {showMACD && indicatorData && (() => {
        const line = indicatorData.macd.line.slice(visibleStart, visibleEnd);
        const signal = indicatorData.macd.signal.slice(visibleStart, visibleEnd);
        const histogram = indicatorData.macd.histogram.slice(visibleStart, visibleEnd);
        const values = [...line, ...signal, ...histogram].filter((value) => Number.isFinite(value));
        if (values.length < 2) return null;
        const low = Math.min(0, ...values);
        const high = Math.max(0, ...values);
        const range = high - low || 1;
        const point = (value: number, index: number, length: number) => ({
          x: (index / Math.max(1, length - 1)) * 100,
          y: 100 - ((value - low) / range) * 100,
        });
        const pathFor = (series: number[]) => series.reduce<string[]>((parts, value, index) => {
          if (!Number.isFinite(value)) return parts;
          const p = point(value, index, series.length);
          parts.push(`${parts.length === 0 ? "M" : "L"} ${p.x} ${p.y}`);
          return parts;
        }, []).join(" ");
        const zeroY = point(0, 0, 1).y;
        return (
          <div
            className="absolute left-0 right-14 h-16 border-t border-border bg-panel/90"
            style={{ bottom: showRSI ? "4rem" : 0 }}
            data-testid="macd-panel"
            role="img"
            aria-label="MACD indicator panel with signal line and histogram"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <line x1="0" x2="100" y1={zeroY} y2={zeroY} stroke="var(--color-border)" strokeWidth="0.15" />
              {histogram.map((value, index) => {
                if (!Number.isFinite(value)) return null;
                const p = point(value, index, histogram.length);
                const width = 80 / Math.max(1, histogram.length);
                return <rect key={index} x={p.x - width / 2} y={Math.min(p.y, zeroY)} width={width} height={Math.max(0.5, Math.abs(zeroY - p.y))} fill={value >= 0 ? "#14b8a6" : "#f43f5e"} opacity="0.55" />;
              })}
              <path d={pathFor(line)} stroke="#3b82f6" strokeWidth="0.3" fill="none" />
              <path d={pathFor(signal)} stroke="#f59e0b" strokeWidth="0.3" fill="none" />
            </svg>
            <div className="pointer-events-none absolute left-2 top-1 text-tv-legend text-muted-foreground">MACD 12 26 9</div>
          </div>
        );
      })()}

      {/* Hover elements */}
      {hover && (
        <>
          <div
            className="tv-tip pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-muted-foreground/70"
            style={{ left: hover.px, opacity: visible ? 1 : 0 }}
          />
          <div
            className="tv-tip pointer-events-none absolute left-0 border-t border-dashed border-muted-foreground/70"
            style={{ top: hover.py, width: `calc(100% - 56px)`, opacity: visible ? 1 : 0 }}
          />
          <div
            className="axis-pill tv-tip pointer-events-none absolute"
            style={{ top: hover.py - 8, right: 6, opacity: visible ? 1 : 0 }}
          >
            {hover.price.toFixed(2)}
          </div>
          <div
            className="axis-pill tv-tip pointer-events-none absolute"
            style={{ left: Math.max(2, Math.min(innerW - 56, hover.px - 26)), bottom: 4, opacity: visible ? 1 : 0 }}
          >
            {data[hover.idx] ? new Date(data[hover.idx].t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}
          </div>

          {c && (
            <div
              key={hover.idx}
              className="tv-tip pointer-events-none absolute z-10 rounded border border-border bg-popover/95 px-2 py-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur"
              style={{ left: tooltipLeft, top: tooltipTop, width: tooltipW, opacity: visible ? 1 : 0 }}
            >
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-tv-legend">
                <span className="text-muted-foreground">O</span>
                <span className="text-right">{c.o.toFixed(2)}</span>
                <span className="text-muted-foreground">H</span>
                <span className="text-right text-bull">{c.h.toFixed(2)}</span>
                <span className="text-muted-foreground">L</span>
                <span className="text-right text-bear">{c.l.toFixed(2)}</span>
                <span className="text-muted-foreground">C</span>
                <span className={`text-right ${c.c >= c.o ? "text-bull" : "text-bear"}`}>{c.c.toFixed(2)}</span>
                <span className="text-muted-foreground">Vol</span>
                <span className="text-right">{(c.v / 1000).toFixed(1)}k</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Drawing info overlay */}
      {drawingTool && (
        <div className="pointer-events-none absolute bottom-4 left-4 bg-panel/95 backdrop-blur rounded border border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Drawing: </span>
          <span className="font-medium capitalize">{drawingTool}</span>
          <span className="text-muted-foreground ml-2">Click and drag to draw</span>
        </div>
      )}
    </div>
  );
}

// Simple chart for mini charts (no drawing tools)
export function CandlestickChartSimple({
  data,
  height = 420
}: {
  data: Candle[];
  height?: number;
}) {
  const { min, max, candleW } = useMemo(() => {
    const min = Math.min(...data.map((d) => d.l));
    const max = Math.max(...data.map((d) => d.h));
    return { min, max, candleW: 100 / data.length };
  }, [data]);

  const pad = (max - min) * 0.05;
  const lo = min - pad;
  const hi = max + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;

  const gridLines = 6;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (hover) setVisible(true);
  }, [hover]);

  function pointToHover(clientX: number, clientY: number): Hover | null {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const innerW = r.width - 56;
    const x = Math.max(0, Math.min(innerW, clientX - r.left));
    const yPx = Math.max(0, Math.min(r.height, clientY - r.top));
    const idx = Math.max(0, Math.min(data.length - 1, Math.floor((x / innerW) * data.length)));
    const price = hi - (yPx / r.height) * (hi - lo);
    return { idx, px: x, py: yPx, price, innerW };
  }

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const h = pointToHover(e.clientX, e.clientY);
    if (h) setHover(h);
  }
  function onLeave() {
    setVisible(false);
    window.setTimeout(() => setHover(null), 140);
  }
  function onTouch(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const h = pointToHover(t.clientX, t.clientY);
    if (h) setHover(h);
    if (e.cancelable) e.preventDefault();
  }
  function onTouchEnd() {
    setVisible(false);
    window.setTimeout(() => setHover(null), 220);
  }

  const c = hover ? data[hover.idx] : null;
  const tooltipW = 168;
  const tooltipH = 110;
  const innerW = hover ? hover.innerW : (wrapRef.current ? wrapRef.current.clientWidth - 56 : 0);
  const preferRight = hover ? hover.px + tooltipW + 20 < innerW : true;
  const tooltipLeft = hover
    ? preferRight
      ? Math.min(hover.px + 14, innerW - tooltipW - 6)
      : Math.max(6, hover.px - tooltipW - 14)
    : 0;
  const tooltipTop = hover
    ? Math.max(6, Math.min(height - tooltipH - 6, hover.py - tooltipH / 2))
    : 0;

  return (
    <div
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="relative w-full cursor-crosshair touch-none bg-background select-none"
      style={{ height }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-y-0 left-0 h-full" style={{ width: "calc(100% - 56px)" }}>
        {Array.from({ length: gridLines }).map((_, i) => (
          <line
            key={i}
            x1="0" x2="100"
            y1={(i / (gridLines - 1)) * 100}
            y2={(i / (gridLines - 1)) * 100}
            stroke="var(--color-grid)"
            strokeWidth="0.1"
          />
        ))}
        {data.map((c, i) => {
          const x = i * candleW + candleW / 2;
          const bull = c.c >= c.o;
          const color = bull ? "var(--color-bull-candle)" : "var(--color-bear-candle)";
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="0.15" />
              <rect
                x={x - candleW * 0.35}
                y={y(Math.max(c.o, c.c))}
                width={candleW * 0.7}
                height={Math.max(0.3, Math.abs(y(c.o) - y(c.c)))}
                fill={color}
              />
            </g>
          );
        })}
      </svg>

      {hover && (
        <>
          <div
            className="tv-tip pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-muted-foreground/70"
            style={{ left: hover.px, opacity: visible ? 1 : 0 }}
          />
          <div
            className="tv-tip pointer-events-none absolute left-0 border-t border-dashed border-muted-foreground/70"
            style={{ top: hover.py, width: `calc(100% - 56px)`, opacity: visible ? 1 : 0 }}
          />
          <div
            className="axis-pill tv-tip pointer-events-none absolute"
            style={{ top: hover.py - 8, right: 6, opacity: visible ? 1 : 0 }}
          >
            {hover.price.toFixed(2)}
          </div>
          <div
            className="axis-pill tv-tip pointer-events-none absolute"
            style={{ left: Math.max(2, Math.min(innerW - 56, hover.px - 26)), bottom: 4, opacity: visible ? 1 : 0 }}
          >
            {new Date(Date.now() - (data.length - hover.idx) * 60_000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>

          {c && (
            <div
              key={hover.idx}
              className="tv-tip pointer-events-none absolute z-10 rounded border border-border bg-popover/95 px-2 py-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur"
              style={{ left: tooltipLeft, top: tooltipTop, width: tooltipW, opacity: visible ? 1 : 0 }}
            >
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-tv-legend">
                <span className="text-muted-foreground">O</span>
                <span className="text-right">{c.o.toFixed(2)}</span>
                <span className="text-muted-foreground">H</span>
                <span className="text-right text-bull">{c.h.toFixed(2)}</span>
                <span className="text-muted-foreground">L</span>
                <span className="text-right text-bear">{c.l.toFixed(2)}</span>
                <span className="text-muted-foreground">C</span>
                <span className={`text-right ${c.c >= c.o ? "text-bull" : "text-bear"}`}>{c.c.toFixed(2)}</span>
                <span className="text-muted-foreground">Vol</span>
                <span className="text-right">{(c.v / 1000).toFixed(1)}k</span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pointer-events-none absolute right-0 top-0 flex h-full w-14 flex-col justify-between border-l border-border bg-panel/60 px-2 py-1 text-tv-legend text-muted-foreground">
        {Array.from({ length: gridLines }).map((_, i) => {
          const v = hi - (i / (gridLines - 1)) * (hi - lo);
          return <div key={i} className="text-right">{v.toFixed(2)}</div>;
        })}
      </div>
    </div>
  );
}
