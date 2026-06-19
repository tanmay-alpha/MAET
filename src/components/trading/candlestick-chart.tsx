import { useMemo, useRef, useState, useEffect, type MouseEvent, type TouchEvent } from "react";
import type { Candle } from "@/lib/mock-data";

type Hover = { idx: number; px: number; py: number; price: number };

export function CandlestickChart({ data, height = 420 }: { data: Candle[]; height?: number }) {
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
  const [visible, setVisible] = useState(false); // controls fade

  // Smooth fade-out: keep last hover briefly so position doesn't jump on re-enter
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
    // delay clearing so fade-out can play
    window.setTimeout(() => setHover(null), 140);
  }
  function onTouch(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const h = pointToHover(t.clientX, t.clientY);
    if (h) setHover(h);
    if (e.cancelable) e.preventDefault(); // stop page scroll while dragging crosshair
  }
  function onTouchEnd() {
    setVisible(false);
    window.setTimeout(() => setHover(null), 220);
  }

  const c = hover ? data[hover.idx] : null;
  const tooltipW = 168;
  const tooltipH = 110;
  const innerW = wrapRef.current ? wrapRef.current.clientWidth - 56 : 0;
  // clamp tooltip both axes so it never spills, and prefer side opposite cursor
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
