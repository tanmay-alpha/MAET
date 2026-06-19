import { useLiveSeries } from "@/hooks/use-live-price";

const SECTORS = [
  { name: "Nifty Bank", base: 51245, chg: -0.17 },
  { name: "Nifty IT", base: 41250, chg: 0.52 },
  { name: "Nifty Auto", base: 24180, chg: 1.12 },
  { name: "Nifty Pharma", base: 21430, chg: 0.34 },
  { name: "Nifty FMCG", base: 58320, chg: -0.21 },
  { name: "Nifty Metal", base: 9842, chg: 1.86 },
  { name: "Nifty Energy", base: 38120, chg: 0.94 },
  { name: "Nifty Realty", base: 1042, chg: -0.62 },
];

function Spark({ seed, bull }: { seed: number; bull: boolean }) {
  const data = useLiveSeries(seed, 28, { volatility: 0.004, interval: 1400 });
  const min = Math.min(...data), max = Math.max(...data);
  const pad = (max - min) * 0.1 || 1;
  const lo = min - pad, hi = max + pad;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${((hi - v) / (hi - lo)) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-8 w-full">
      <polyline points={pts} fill="none" stroke={bull ? "var(--color-bull)" : "var(--color-bear)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SectorStrip() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4 lg:grid-cols-8">
      {SECTORS.map((s) => {
        const bull = s.chg >= 0;
        return (
          <div key={s.name} className="bg-panel/80 p-3">
            <div className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.name}</div>
            <div className={`mt-0.5 font-mono tabular text-xs font-semibold ${bull ? "text-bull" : "text-bear"}`}>
              {bull ? "+" : ""}{s.chg.toFixed(2)}%
            </div>
            <div className="mt-1"><Spark seed={s.base} bull={bull} /></div>
          </div>
        );
      })}
    </div>
  );
}
