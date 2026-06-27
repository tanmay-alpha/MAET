import { useMarketQuotes } from "@/hooks/use-market-quotes";

type Cell = { sym: string; quoteSymbol?: string; w: number; chg?: number };

const COMPONENTS: Cell[] = [
  { sym: "RELIANCE", w: 18 },
  { sym: "HDFCBANK", w: 14 },
  { sym: "TCS", w: 11 },
  { sym: "ICICIBANK", w: 10 },
  { sym: "INFY", w: 9 },
  { sym: "BHARTIARTL", w: 8 },
  { sym: "SBIN", w: 7 },
  { sym: "ITC", w: 6 },
  { sym: "LT", w: 5 },
  { sym: "AXISBANK", w: 4 },
  { sym: "MARUTI", w: 3 },
  { sym: "HUL", quoteSymbol: "HINDUNILVR", w: 3 },
  { sym: "BAJFIN", quoteSymbol: "BAJFINANCE", w: 2 },
];

function shadeFor(chg?: number) {
  if (chg === undefined) return "var(--color-panel)";
  const v = Math.max(-3, Math.min(3, chg));
  const intensity = Math.min(0.85, 0.18 + Math.abs(v) * 0.22);
  const color = v >= 0 ? "var(--color-bull)" : "var(--color-bear)";
  return `color-mix(in oklab, ${color} ${(intensity * 100).toFixed(0)}%, var(--color-panel))`;
}

// simple squarified-ish layout
function layout(cells: Cell[], W: number, H: number) {
  const total = cells.reduce((s, c) => s + c.w, 0);
  const out: (Cell & { x: number; y: number; w: number; h: number })[] = [];
  let y = 0;
  const rowMax = W;
  let row: Cell[] = [];

  const flushRow = () => {
    if (!row.length) return;
    const rowWeight = row.reduce((s, c) => s + c.w, 0);
    const h = (rowWeight / total) * H * (W / rowMax) * 1.6;
    let cx = 0;
    for (const c of row) {
      const w = (c.w / rowWeight) * W;
      out.push({ ...c, x: cx, y, w, h });
      cx += w;
    }
    y += h;
    row = [];
  };

  for (const c of cells) {
    row.push(c);
    if (row.length >= 3 + Math.floor(y / 80)) flushRow();
  }
  flushRow();
  // normalize heights to fill H
  const totalH = out.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  const k = H / totalH;
  return out.map((r) => ({ ...r, y: r.y * k, h: r.h * k }));
}

export function MarketHeatmap({ height = 320 }: { height?: number }) {
  const { quoteMap } = useMarketQuotes(COMPONENTS.map((cell) => cell.quoteSymbol ?? cell.sym));
  const cells = COMPONENTS.map((cell) => ({
    ...cell,
    chg: quoteMap.get(cell.quoteSymbol ?? cell.sym)?.changePct,
  }));

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
            {r.chg === undefined ? "—" : `${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(2)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}
