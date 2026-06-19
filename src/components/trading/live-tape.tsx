import { useEffect, useState } from "react";

type Print = { id: number; sym: string; side: "B" | "S"; qty: number; px: number; ts: string };

const SYMS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "BHARTIARTL", "ITC", "SBIN", "AXISBANK", "LT"];
const SEED: Record<string, number> = {
  RELIANCE: 2945, TCS: 4128, HDFCBANK: 1672, INFY: 1845, ICICIBANK: 1245,
  BHARTIARTL: 1532, ITC: 472, SBIN: 821, AXISBANK: 1158, LT: 3654,
};

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString("en-IN", { hour12: false }).padStart(8, "0");
}

export function LiveTape({ rows = 12 }: { rows?: number }) {
  const [prints, setPrints] = useState<Print[]>([]);

  useEffect(() => {
    // seed on client only to avoid SSR hydration mismatch
    const init: Print[] = Array.from({ length: rows }).map((_, i) => {
      const sym = SYMS[i % SYMS.length];
      return { id: i, sym, side: Math.random() > 0.5 ? "B" : "S", qty: 25 * (1 + Math.floor(Math.random() * 8)), px: SEED[sym] + Math.random() * 4 - 2, ts: fmtTime() };
    });
    setPrints(init);
  }, [rows]);

  useEffect(() => {
    let next = prints.length;
    const id = window.setInterval(() => {
      const sym = SYMS[Math.floor(Math.random() * SYMS.length)];
      const p: Print = {
        id: next++,
        sym,
        side: Math.random() > 0.5 ? "B" : "S",
        qty: 25 * (1 + Math.floor(Math.random() * 8)),
        px: +(SEED[sym] + (Math.random() - 0.5) * 6).toFixed(2),
        ts: fmtTime(),
      };
      setPrints((arr) => [p, ...arr].slice(0, rows));
    }, 850);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return (
    <div className="rounded-md border border-border bg-panel/80 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-bull/70" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
          </span>
          Live tape · NSE
        </div>
        <div className="font-mono tabular text-[10px] text-muted-foreground">{prints.length} prints</div>
      </div>
      <div className="divide-y divide-border/60">
        {prints.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 px-3 py-1 font-mono tabular text-[11px] ${i === 0 ? (p.side === "B" ? "flash-bull" : "flash-bear") : ""}`}
          >
            <span className="w-16 text-muted-foreground">{p.ts}</span>
            <span className="flex-1 truncate font-medium text-foreground">{p.sym}</span>
            <span className={`w-5 text-center font-semibold ${p.side === "B" ? "text-bull" : "text-bear"}`}>{p.side}</span>
            <span className="w-12 text-right text-muted-foreground">{p.qty}</span>
            <span className="w-20 text-right">{p.px.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
