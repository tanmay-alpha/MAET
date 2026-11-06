import { rupees, shortDate } from "./format";

export interface EquityPoint {
  /** Epoch milliseconds or an ISO timestamp. */
  time: number | string;
  equity: number;
}

/**
 * Equity curve as a single line on a plain grid, with the range and dates labelled.
 * Green when the run ended above its start, red otherwise.
 */
export function EquityLine({ points, height = 220, label }: { points: EquityPoint[]; height?: number; label: string }) {
  const finite = points.filter((p) => Number.isFinite(p.equity));
  if (finite.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-muted-foreground">
        No equity curve recorded for this run
      </div>
    );
  }
  const values = finite.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const line = finite
    .map((p, i) => `${((i / (finite.length - 1)) * 100).toFixed(3)},${(100 - ((p.equity - min) / spread) * 100).toFixed(3)}`)
    .join(" ");
  const first = finite[0];
  const last = finite[finite.length - 1];
  const stroke = last.equity >= first.equity ? "var(--color-bull)" : "var(--color-bear)";

  return (
    <figure aria-label={label} className="relative font-mono text-[10px] text-muted-foreground" style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-0 top-4 bottom-4 h-[calc(100%-2rem)] w-full" aria-hidden>
        {[0, 25, 50, 75, 100].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute left-0 top-0">{rupees(max, 0)}</span>
      <span className="absolute right-0 top-0 text-foreground">Last {rupees(last.equity, 0)}</span>
      <span className="absolute bottom-0 left-0">{shortDate(first.time)} · low {rupees(min, 0)}</span>
      <span className="absolute bottom-0 right-0">{shortDate(last.time)}</span>
    </figure>
  );
}
