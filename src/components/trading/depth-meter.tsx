import { useEffect, useState } from "react";

type Level = { px: number; qty: number };

function gen(seed: number, side: "bid" | "ask"): Level[] {
  return Array.from({ length: 6 }).map((_, i) => ({
    px: +(seed + (side === "bid" ? -1 : 1) * (i + 1) * 0.45).toFixed(2),
    qty: 100 + Math.floor(Math.random() * 1200),
  }));
}

export function DepthMeter({ seed = 2945 }: { seed?: number }) {
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);

  useEffect(() => {
    setBids(gen(seed, "bid"));
    setAsks(gen(seed, "ask"));
    const id = window.setInterval(() => {
      setBids(gen(seed, "bid"));
      setAsks(gen(seed, "ask"));
    }, 1100);
    return () => window.clearInterval(id);
  }, [seed]);

  const maxQ = Math.max(1, ...bids.map((b) => b.qty), ...asks.map((a) => a.qty));

  return (
    <div className="rounded-md border border-border bg-panel/80 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Order book</span><span>RELIANCE</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px] font-mono tabular">
        <div className="space-y-0.5">
          {bids.map((b, i) => (
            <div key={i} className="relative flex justify-between rounded px-1.5 py-0.5">
              <div className="absolute inset-y-0 right-0 rounded bg-bull/15" style={{ width: `${(b.qty / maxQ) * 100}%` }} />
              <span className="relative text-bull">{b.px.toFixed(2)}</span>
              <span className="relative text-muted-foreground">{b.qty}</span>
            </div>
          ))}
        </div>
        <div className="space-y-0.5">
          {asks.map((a, i) => (
            <div key={i} className="relative flex justify-between rounded px-1.5 py-0.5">
              <div className="absolute inset-y-0 left-0 rounded bg-bear/15" style={{ width: `${(a.qty / maxQ) * 100}%` }} />
              <span className="relative text-bear">{a.px.toFixed(2)}</span>
              <span className="relative text-muted-foreground">{a.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
