import { useEffect, useState } from "react";

type Row = { label: string; net: number; buy: number; sell: number };

const BASE: Row[] = [
  { label: "FII · Cash", net: 1248.42, buy: 8412, sell: 7163.58 },
  { label: "DII · Cash", net: -312.16, buy: 6204, sell: 6516.16 },
  { label: "FII · Index Fut", net: 412.05, buy: 2104, sell: 1691.95 },
  { label: "FII · Stock Fut", net: -184.30, buy: 3618, sell: 3802.30 },
];

export function FlowsWidget() {
  const [rows, setRows] = useState(BASE);
  useEffect(() => {
    const id = setInterval(() => {
      setRows((prev) => prev.map((r) => {
        const d = (Math.random() - 0.5) * 30;
        return { ...r, net: +(r.net + d).toFixed(2), buy: +(r.buy + Math.random() * 20).toFixed(2), sell: +(r.sell + Math.random() * 20).toFixed(2) };
      }));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Institutional flows</div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
          provisional · ₹ Cr
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((r) => {
          const positive = r.net >= 0;
          const mag = Math.min(100, Math.abs(r.net) / 18);
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-foreground/90">{r.label}</span>
                <span className={`font-mono tabular text-sm font-semibold ${positive ? "text-bull" : "text-bear"}`}>
                  {positive ? "+" : ""}{r.net.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-accent/60">
                <div className="h-full bg-muted-foreground/30" style={{ width: "50%" }} />
                {positive ? (
                  <div className="h-full bg-bull transition-all" style={{ width: `${mag / 2}%`, marginLeft: `0%` }} />
                ) : (
                  <div className="h-full bg-bear transition-all" style={{ width: `${mag / 2}%`, marginLeft: `${50 - mag / 2}%`, marginRight: "50%" }} />
                )}
              </div>
              <div className="mt-1 flex justify-between font-mono tabular text-[10px] text-muted-foreground">
                <span>Buy {r.buy.toFixed(0)}</span>
                <span>Sell {r.sell.toFixed(0)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
