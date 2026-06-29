import { useMemo, useRef, useState, useEffect, useCallback, type MouseEvent, type TouchEvent } from "react";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type Hover = { idx: number; px: number; py: number; price: number };

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
}

export function CandlestickChart({
  data,
  height = 420,
  chartState,
  onChartStateChange,
  drawingTool
}: CandlestickChartProps) {
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
    return { idx, px: x, py: yPx, price };
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
  const innerW = wrapRef.current ? wrapRef.current.clientWidth - 56 : 0;
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
    return { idx, px: x, py: yPx, price };
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
  const innerW = wrapRef.current ? wrapRef.current.clientWidth - 56 : 0;
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
