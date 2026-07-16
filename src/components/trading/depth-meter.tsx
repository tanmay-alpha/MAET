import { useTerminalStore } from "@/store/useTerminalStore";
import { Info, Cpu } from "lucide-react";

export function DepthMeter() {
  const level2 = useTerminalStore((state) => state.level2Depth);
  const greeks = useTerminalStore((state) => state.activeGreeks);
  const activeSymbol = useTerminalStore((state) => state.activeSymbol);

  const totalBidQty = level2?.bids.reduce((sum, b) => sum + b.qty, 0) || 1;
  const totalAskQty = level2?.asks.reduce((sum, a) => sum + a.qty, 0) || 1;
  const maxQty = Math.max(
    ...[...(level2?.bids || []), ...(level2?.asks || [])].map((x) => x.qty),
    1
  );

  return (
    <div className="rounded-lg border border-border bg-panel/60 p-4 shadow-xl backdrop-blur-md transition-all duration-300 hover:shadow-2xl">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="text-[10px] uppercase font-bold tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-primary animate-pulse" />
          Market Depth & Greeks · {activeSymbol}
        </div>
        <span className="rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary">L2 Live</span>
      </div>

      {level2 ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Bids (BUY Orders) */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold pb-1 border-b border-border/40">
                <span>Qty</span>
                <span className="text-right col-span-2">Bid Price</span>
              </div>
              {level2.bids.map((bid, i) => {
                const pct = (bid.qty / maxQty) * 100;
                return (
                  <div key={`bid-${i}`} className="relative grid grid-cols-3 text-xs font-mono py-1 items-center overflow-hidden">
                    <div 
                      className="absolute inset-y-0 right-0 bg-bull/10 transition-all duration-300 rounded" 
                      style={{ width: `${pct}%` }}
                    />
                    <span className="z-10 text-muted-foreground">{bid.qty.toLocaleString()}</span>
                    <span className="z-10 text-right col-span-2 text-bull font-semibold">₹{bid.price.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>

            {/* Asks (SELL Orders) */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold pb-1 border-b border-border/40">
                <span>Ask Price</span>
                <span className="text-right col-span-2">Qty</span>
              </div>
              {level2.asks.map((ask, i) => {
                const pct = (ask.qty / maxQty) * 100;
                return (
                  <div key={`ask-${i}`} className="relative grid grid-cols-3 text-xs font-mono py-1 items-center overflow-hidden">
                    <div 
                      className="absolute inset-y-0 left-0 bg-bear/10 transition-all duration-300 rounded" 
                      style={{ width: `${pct}%` }}
                    />
                    <span className="z-10 text-bear font-semibold">₹{ask.price.toFixed(2)}</span>
                    <span className="z-10 text-right col-span-2 text-muted-foreground">{ask.qty.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>Total Bids: {totalBidQty.toLocaleString()}</span>
              <span>Total Asks: {totalAskQty.toLocaleString()}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-bear/20 overflow-hidden flex">
              <div 
                className="h-full bg-bull transition-all duration-300"
                style={{ width: `${(totalBidQty / (totalBidQty + totalAskQty)) * 100}%` }}
              />
              <div 
                className="h-full bg-bear transition-all duration-300"
                style={{ width: `${(totalAskQty / (totalBidQty + totalAskQty)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded border border-dashed border-border px-3 py-6 text-center">
          <div className="text-xs font-medium text-muted-foreground">Waiting for Level 2 stream data...</div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-border/60">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1">
          <Info className="h-3 w-3" /> Options Greeks (Live)
        </div>
        {greeks ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md bg-panel-elevated/40 border border-border/50 p-2 text-center transition-all hover:bg-accent/40">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Delta</div>
              <div className="font-mono text-xs font-bold text-foreground mt-0.5">{greeks.delta.toFixed(4)}</div>
            </div>
            <div className="rounded-md bg-panel-elevated/40 border border-border/50 p-2 text-center transition-all hover:bg-accent/40">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Theta</div>
              <div className="font-mono text-xs font-bold text-bear mt-0.5">{greeks.theta.toFixed(2)}</div>
            </div>
            <div className="rounded-md bg-panel-elevated/40 border border-border/50 p-2 text-center transition-all hover:bg-accent/40">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Vega</div>
              <div className="font-mono text-xs font-bold text-primary mt-0.5">{greeks.vega.toFixed(2)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
            Options Greeks unavailable for this symbol
          </div>
        )}
      </div>
    </div>
  );
}
