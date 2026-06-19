import { createFileRoute } from "@tanstack/react-router";
import { equityCurve } from "@/lib/mock-data";
import { Fragment, useMemo } from "react";

export const Route = createFileRoute("/_app/backtest")({
  head: () => ({ meta: [{ title: "Backtest — MAET" }] }),
  component: Backtest,
});

function Curve({ data }: { data: { x: number; y: number }[] }) {
  const min = Math.min(...data.map((d) => d.y));
  const max = Math.max(...data.map((d) => d.y));
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${100 - ((d.y - min) / (max - min)) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="bt" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-bull)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-bull)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }).map((_, i) => (
        <line key={i} x1="0" x2="100" y1={(i / 4) * 100} y2={(i / 4) * 100} stroke="var(--color-grid)" strokeWidth="0.1" />
      ))}
      <polyline points={`0,100 ${pts} 100,100`} fill="url(#bt)" stroke="none" />
      <polyline points={pts} fill="none" stroke="var(--color-bull)" strokeWidth="0.5" />
    </svg>
  );
}

function Backtest() {
  const curve = useMemo(() => equityCurve(180), []);
  const metrics = [
    { label: "Total return", value: "+42.85%", trend: "up" },
    { label: "CAGR", value: "+28.40%", trend: "up" },
    { label: "Sharpe ratio", value: "2.14", trend: "up" },
    { label: "Sortino ratio", value: "3.02", trend: "up" },
    { label: "Max drawdown", value: "-8.42%", trend: "down" },
    { label: "Win rate", value: "64.2%", trend: "up" },
    { label: "Profit factor", value: "1.92", trend: "up" },
    { label: "Avg trade", value: "₹1,245", trend: "up" },
  ];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Backtest — Nifty Momentum Burst</h1>
        <p className="text-xs text-muted-foreground">Period: 01 Jan 2024 → 17 Jun 2026 · Capital: ₹10,00,000</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy</div>
          <select className="mt-1 w-full bg-transparent text-sm font-medium outline-none">
            <option>Nifty Momentum Burst</option>
            <option>Bank Nifty Mean Reversion</option>
            <option>IT Sector Rotation</option>
          </select>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Instrument</div>
          <div className="mt-1 text-sm font-medium">NIFTY 50 Index</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeframe</div>
          <div className="mt-1 text-sm font-medium">5 minute</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-bull" /> Completed
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Equity curve</div>
          <div className="h-80 p-2"><Curve data={curve} /></div>
        </div>
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Performance</div>
          <div className="divide-y divide-border">
            {metrics.map((m) => (
              <div key={m.label} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">{m.label}</span>
                <span className={`font-mono tabular font-semibold ${m.trend === "up" ? "text-bull" : m.trend === "down" ? "text-bear" : ""}`}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-medium">Monthly returns</div>
          <div className="text-xs text-muted-foreground">Heatmap (%)</div>
        </div>
        <div className="grid gap-1 p-3 text-[10px]" style={{ gridTemplateColumns: "auto repeat(12, minmax(0, 1fr))" }}>
          <div />
          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => (
            <div key={m} className="text-center text-muted-foreground">{m}</div>
          ))}
          {[2024, 2025, 2026].map((y) => (
            <Fragment key={y}>
              <div className="text-muted-foreground">{y}</div>
              {Array.from({ length: 12 }).map((_, i) => {
                const v = (Math.sin(y + i * 1.3) * 5 + (Math.random() - 0.3) * 4).toFixed(1);
                const n = +v;
                const intensity = Math.min(1, Math.abs(n) / 8);
                const bg = n >= 0
                  ? `color-mix(in oklab, var(--color-bull) ${intensity * 70}%, transparent)`
                  : `color-mix(in oklab, var(--color-bear) ${intensity * 70}%, transparent)`;
                return (
                  <div key={`${y}-${i}`} className="rounded py-1.5 text-center font-mono tabular" style={{ backgroundColor: bg }}>
                    {n >= 0 ? "+" : ""}{v}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
