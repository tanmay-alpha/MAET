import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { trpc, type HeatmapCell } from "@/lib/trpc";

function shadeFor(chg?: number) {
  if (chg === undefined) return "var(--color-panel)";
  const v = Math.max(-3, Math.min(3, chg));
  const intensity = Math.min(0.85, 0.18 + Math.abs(v) * 0.22);
  const color = v >= 0 ? "var(--color-bull)" : "var(--color-bear)";
  return `color-mix(in oklab, ${color} ${(intensity * 100).toFixed(0)}%, var(--color-panel))`;
}

type LayoutCell = HeatmapCell & {
  x: number;
  y: number;
  w: number;
  h: number;
};

// Squarified row-packing layout proportional to verified market cap weight
function computeLayout(cells: HeatmapCell[], totalW: number, totalH: number): LayoutCell[] {
  if (cells.length === 0) return [];

  // Minimum display weight for visibility
  const totalWeight = cells.reduce((sum, c) => sum + (c.weight > 0 ? c.weight : 0.5), 0);
  if (totalWeight <= 0) return [];

  const out: LayoutCell[] = [];
  let currentY = 0;
  let currentRow: HeatmapCell[] = [];

  const flushRow = () => {
    if (currentRow.length === 0) return;
    const rowWeight = currentRow.reduce((sum, c) => sum + (c.weight > 0 ? c.weight : 0.5), 0);
    const rowHeight = (rowWeight / totalWeight) * totalH * 1.5;

    let currentX = 0;
    for (const c of currentRow) {
      const cellWeight = c.weight > 0 ? c.weight : 0.5;
      const cellWidth = (cellWeight / rowWeight) * totalW;
      out.push({
        ...c,
        x: currentX,
        y: currentY,
        w: cellWidth,
        h: rowHeight,
      });
      currentX += cellWidth;
    }

    currentY += rowHeight;
    currentRow = [];
  };

  const sortedCells = [...cells].sort((a, b) => b.weight - a.weight);
  const targetCols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(cells.length * 1.6))));

  for (const cell of sortedCells) {
    currentRow.push(cell);
    if (currentRow.length >= targetCols) {
      flushRow();
    }
  }
  flushRow();

  // Normalize heights to precisely fill totalH
  const maxY = out.reduce((max, r) => Math.max(max, r.y + r.h), 0);
  const k = maxY > 0 ? totalH / maxY : 1;
  return out.map((r) => ({ ...r, y: r.y * k, h: r.h * k }));
}

/** ALL_NSE heatmap cells; marketBreadth procedures require a session, so pass `enabled: signedIn`. */
export function useHeatmapCells(enabled: boolean) {
  return useQuery({
    queryKey: ["marketBreadth", "heatmap", "ALL_NSE"],
    queryFn: () => trpc.marketBreadth.getHeatmapCells.query({ universe: "ALL_NSE" }),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function MarketHeatmap({ cells, height = 500 }: { cells: HeatmapCell[]; height?: number }) {
  const rects = computeLayout(cells, 100, height);

  return (
    <div className="relative w-full overflow-hidden bg-panel" style={{ height }}>
      {rects.map((r) => {
        const mCapStr = r.marketCap
          ? `₹${(r.marketCap / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`
          : "Market cap —";
        const tooltip = `${r.symbol} (${r.name})\nSector: ${r.sector}\nPrice: ₹${r.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nChange: ${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%\n${mCapStr}\nWeight: ${r.weight.toFixed(2)}%`;

        return (
          <Link
            key={r.symbol}
            to="/stock/$symbol"
            params={{ symbol: r.symbol }}
            title={tooltip}
            className="absolute flex flex-col items-center justify-center overflow-hidden border border-background/40 px-1 text-center select-none hover:brightness-125"
            style={{
              left: `${r.x}%`,
              top: r.y,
              width: `${r.w}%`,
              height: r.h,
              background: shadeFor(r.changePct),
            }}
          >
            <span
              className="font-semibold leading-tight text-foreground"
              style={{ fontSize: Math.max(9, Math.min(15, r.h / 5)) }}
            >
              {r.symbol}
            </span>
            <span
              className="font-mono tabular text-foreground/90"
              style={{ fontSize: Math.max(8, Math.min(12, r.h / 7)) }}
            >
              {r.changePct === undefined ? "—" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}
            </span>
            {r.h > 65 && r.w > 8 && (
              <span
                className="text-[9px] text-foreground/70 hidden sm:inline"
              >
                {r.weight > 0 ? `${r.weight.toFixed(1)}%` : ""}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
