import { useMarketQuotes } from "@/hooks/use-market-quotes";

const SECTORS = [
  { name: "Nifty Bank", symbol: "BANKNIFTY" },
  { name: "Nifty IT", symbol: "NIFTYIT" },
  { name: "Nifty FMCG", symbol: "NIFTYFMCG" },
];

export function SectorStrip() {
  const { quoteMap } = useMarketQuotes(SECTORS.map((sector) => sector.symbol));
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
      {SECTORS.map((sector) => {
        const quote = quoteMap.get(sector.symbol);
        const change = quote?.changePct;
        const bull = (change ?? 0) >= 0;
        return (
          <div key={sector.name} className="bg-panel/80 p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{sector.name}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm font-semibold tabular tabular-nums">{quote?.price.toLocaleString("en-IN") ?? "—"}</span>
              <span className={`font-mono text-xs font-semibold tabular tabular-nums ${bull ? "text-bull" : "text-bear"}`}>
                {change === undefined ? "Waiting for quote" : `${bull ? "+" : ""}${change.toFixed(2)}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
