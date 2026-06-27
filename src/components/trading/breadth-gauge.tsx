import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { WATCHLIST } from "@/lib/market-catalog";

export function BreadthGauge() {
  const { quoteMap } = useMarketQuotes(WATCHLIST.map((item) => item.symbol));
  const changes = [...quoteMap.values()].map((quote) => quote.changePct).filter((value) => value !== undefined);
  const adv = changes.filter((value) => value > 0).length;
  const dec = changes.filter((value) => value < 0).length;
  const unc = changes.filter((value) => value === 0).length;
  const total = adv + dec + unc;
  const advPct = total ? (adv / total) * 100 : 0;
  const decPct = total ? (dec / total) * 100 : 0;
  const ratio = adv / Math.max(1, dec);

  // gauge angle: -90 (full bear) to +90 (full bull)
  const norm = Math.max(-1, Math.min(1, (adv - dec) / Math.max(1, adv + dec)));
  const angle = norm * 80;

  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Watchlist breadth · NSE</div>
        <div className="font-mono tabular text-[10px] text-muted-foreground">{total}/{WATCHLIST.length} quotes</div>
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
          <div className="font-mono tabular text-2xl font-semibold">{total ? ratio.toFixed(2) : "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Adv / Dec</div>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div className="h-full bg-bull transition-all" style={{ width: `${advPct}%` }} />
        <div className="h-full -mt-1.5 bg-bear transition-all" style={{ width: `${decPct}%`, marginLeft: `${advPct}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="font-mono tabular text-bull">▲ {adv.toLocaleString("en-IN")}</span>
        <span className="font-mono tabular text-muted-foreground">— {unc}</span>
        <span className="font-mono tabular text-bear">▼ {dec.toLocaleString("en-IN")}</span>
      </div>
    </div>
  );
}
