import { useTerminalStore } from "@/store/useTerminalStore";
import { Info, ShieldAlert } from "lucide-react";

export function DepthMeter() {
  const activeSymbol = useTerminalStore((state) => state.activeSymbol);

  return (
    <div className="rounded-lg border border-border bg-panel/60 p-4 shadow-sm text-xs space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-primary" />
          Market Data Quality · {activeSymbol}
        </div>
        <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
          Level 1 Feed
        </span>
      </div>

      <div className="rounded border border-border/80 bg-panel/40 p-3 space-y-2">
        <div className="font-semibold text-foreground text-xs flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          Honest Market Data Policy
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Level-2 5-depth orderbook and Options Greeks are hidden until verified real-time exchange streams are connected.
          Paper trades are executed strictly against verified Level-1 market quotes.
        </p>
      </div>
    </div>
  );
}
