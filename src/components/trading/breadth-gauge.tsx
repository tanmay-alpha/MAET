import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export function BreadthGauge() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketBreadth", "overview", "ALL_NSE"],
    queryFn: () => trpc.marketBreadth.getOverview.query({ universe: "ALL_NSE" }),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-panel p-5 text-center text-xs text-muted-foreground">
        Loading verified market breadth…
      </div>
    );
  }

  if (isError || !data?.available) {
    return (
      <div className="rounded-lg border border-border bg-panel p-5 text-center text-xs text-muted-foreground">
        {data?.reason || "Market breadth temporarily unavailable"}
      </div>
    );
  }

  const adv = data.advances ?? 0;
  const dec = data.declines ?? 0;
  const unc = data.unchanged ?? 0;
  const total = adv + dec + unc;
  const advPct = total > 0 ? (adv / total) * 100 : 0;
  const decPct = total > 0 ? (dec / total) * 100 : 0;

  // Gauge angle: -80 (full bear) to +80 (full bull)
  const norm = (adv + dec > 0) ? Math.max(-1, Math.min(1, (adv - dec) / (adv + dec))) : 0;
  const angle = norm * 80;

  const ratioDisplay = data.advanceDeclineRatio !== null && data.advanceDeclineRatio !== undefined
    ? data.advanceDeclineRatio.toFixed(2)
    : "—";

  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Market Breadth · ALL NSE</div>
        <div className="font-mono tabular text-[10px] text-muted-foreground">
          {data.companiesWithUsableQuote}/{data.eligibleCompanies} verified ({((data.quoteCoverage ?? 0) * 100).toFixed(0)}%)
        </div>
      </div>

      <div className="relative mx-auto mt-3 h-[120px] w-[220px]">
        <svg viewBox="0 0 220 120" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="bgrad" x1="0" x2="1">
              <stop offset="0%" stopColor="var(--color-bear)" />
              <stop offset="50%" stopColor="var(--color-muted-foreground)" />
              <stop offset="100%" stopColor="var(--color-bull)" />
            </linearGradient>
          </defs>
          <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="url(#bgrad)" strokeWidth="14" strokeLinecap="round" opacity="0.75" />
          {/* ticks */}
          {Array.from({ length: 9 }).map((_, i) => {
            const a = -180 + (i / 8) * 180;
            const r1 = 78, r2 = 88;
            const x1 = 110 + Math.cos((a * Math.PI) / 180) * r1;
            const y1 = 110 + Math.sin((a * Math.PI) / 180) * r1;
            const x2 = 110 + Math.cos((a * Math.PI) / 180) * r2;
            const y2 = 110 + Math.sin((a * Math.PI) / 180) * r2;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-foreground)" strokeOpacity="0.25" strokeWidth="1" />;
          })}
          {/* needle */}
          <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "110px 110px", transition: "transform 700ms cubic-bezier(.2,.8,.2,1)" }}>
            <line x1="110" y1="110" x2="110" y2="32" stroke="var(--color-foreground)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="110" cy="110" r="6" fill="var(--color-panel-elevated)" stroke="var(--color-foreground)" strokeWidth="1.5" />
          </g>
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className="font-mono tabular text-2xl font-semibold">{ratioDisplay}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Adv / Dec Ratio</div>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div className="h-full bg-bull transition-all" style={{ width: `${advPct}%` }} />
        <div className="h-full -mt-1.5 bg-bear transition-all" style={{ width: `${decPct}%`, marginLeft: `${advPct}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="font-mono tabular text-bull">▲ {adv.toLocaleString("en-IN")}</span>
        <span className="font-mono tabular text-muted-foreground">— {unc.toLocaleString("en-IN")}</span>
        <span className="font-mono tabular text-bear">▼ {dec.toLocaleString("en-IN")}</span>
      </div>

      {/* SMA Breadth Indicators */}
      <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="rounded bg-background p-1.5">
          <div className="text-muted-foreground">&gt; 20 SMA</div>
          <div className="font-mono font-semibold text-foreground mt-0.5">{data.pctAboveSma20}%</div>
          <div className="text-[9px] text-muted-foreground/70">{data.aboveSma20}/{data.sma20Eligible}</div>
        </div>
        <div className="rounded bg-background p-1.5">
          <div className="text-muted-foreground">&gt; 50 SMA</div>
          <div className="font-mono font-semibold text-foreground mt-0.5">{data.pctAboveSma50}%</div>
          <div className="text-[9px] text-muted-foreground/70">{data.aboveSma50}/{data.sma50Eligible}</div>
        </div>
        <div className="rounded bg-background p-1.5">
          <div className="text-muted-foreground">&gt; 200 SMA</div>
          <div className="font-mono font-semibold text-foreground mt-0.5">{data.pctAboveSma200}%</div>
          <div className="text-[9px] text-muted-foreground/70">{data.aboveSma200}/{data.sma200Eligible}</div>
        </div>
      </div>
    </div>
  );
}
