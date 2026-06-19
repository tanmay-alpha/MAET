import { useEffect, useState } from "react";

type Cell = { sym: string; w: number; chg: number };

const SEED: Cell[] = [
  { sym: "RELIANCE", w: 18, chg: 1.10 },
  { sym: "HDFCBANK", w: 14, chg: 0.74 },
  { sym: "TCS", w: 11, chg: -0.44 },
  { sym: "ICICIBANK", w: 10, chg: 0.19 },
  { sym: "INFY", w: 9, chg: 0.47 },
  { sym: "BHARTIARTL", w: 8, chg: 1.23 },
  { sym: "SBIN", w: 7, chg: 1.10 },
  { sym: "ITC", w: 6, chg: 0.22 },
  { sym: "LT", w: 5, chg: 0.51 },
  { sym: "AXISBANK", w: 4, chg: -0.79 },
  { sym: "MARUTI", w: 3, chg: 1.12 },
  { sym: "HUL", w: 3, chg: -0.10 },
  { sym: "BAJFIN", w: 2, chg: -0.13 },
];

function shadeFor(chg: number) {
  const v = Math.max(-3, Math.min(3, chg));
  const intensity = Math.min(0.85, 0.18 + Math.abs(v) * 0.22);
  const color = v >= 0 ? "var(--color-bull)" : "var(--color-bear)";
  return `color-mix(in oklab, ${color} ${(intensity * 100).toFixed(0)}%, var(--color-panel))`;
}

// simple squarified-ish layout
function layout(cells: Cell[], W: number, H: number) {
  const total = cells.reduce((s, c) => s + c.w, 0);
  const out: (Cell & { x: number; y: number; w: number; h: number })[] = [];
  let x = 0, y = 0, rowH = 0, rowW = 0;
  const rowMax = W;
  let row: Cell[] = [];

  const flushRow = () => {
    if (!row.length) return;
    const rowWeight = row.reduce((s, c) => s + c.w, 0);
    const h = (rowWeight / total) * H * (W / rowMax) * 1.6;
    let cx = x;
    for (const c of row) {
      const w = (c.w / rowWeight) * W;
      out.push({ ...c, x: cx, y, w, h });
      cx += w;
    }
    y += h;
    row = []; rowH = 0; rowW = 0;
  };

  for (const c of cells) {
    row.push(c);
    rowW += c.w;
    if (row.length >= 3 + Math.floor(y / 80)) flushRow();
  }
  flushRow();
  // normalize heights to fill H
  const totalH = out.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  const k = H / totalH;
  return out.map((r) => ({ ...r, y: r.y * k, h: r.h * k }));
}

export function MarketHeatmap({ height = 320 }: { height?: number }) {
  const [cells, setCells] = useState(SEED);
  useEffect(() => {
    const id = setInterval(() => {
      setCells((prev) => prev.map((c) => ({ ...c, chg: +(c.chg + (Math.random() - 0.5) * 0.15).toFixed(2) })));
    }, 1800);
    return () => clearInterval(id);
  }, []);

  const rects = layout(cells, 100, height);
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-panel" style={{ height }}>
      {rects.map((r) => (
        <div
          key={r.sym}
          className="absolute flex flex-col items-center justify-center border border-background/40 px-1 text-center transition-colors"
          style={{
            left: `${r.x}%`,
            top: r.y,
            width: `${r.w}%`,
            height: r.h,
            background: shadeFor(r.chg),
          }}
        >
          <span className="font-semibold leading-tight text-foreground" style={{ fontSize: Math.max(9, Math.min(15, r.h / 5)) }}>{r.sym}</span>
          <span className="font-mono tabular text-foreground/85" style={{ fontSize: Math.max(8, Math.min(12, r.h / 7)) }}>
            {r.chg >= 0 ? "+" : ""}{r.chg.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}
