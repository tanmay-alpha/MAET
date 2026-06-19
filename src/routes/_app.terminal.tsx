import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Watchlist } from "@/components/trading/watchlist";
import { OrderPanel } from "@/components/trading/order-panel";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { generateCandles, WATCHLIST, POSITIONS } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({ meta: [{ title: "Terminal — MAET" }] }),
  component: Terminal,
});

const INTERVALS = ["1m", "5m", "15m", "1h", "1D", "1W"];

function Terminal() {
  const [active, setActive] = useState("RELIANCE");
  const [interval, setInterval] = useState("5m");
  const current = WATCHLIST.find((w) => w.symbol === active)!;
  const candles = useMemo(() => generateCandles(120, current.price - 20), [active, interval]);

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-[260px_1fr_260px]">
      <div className="border-r border-border"><Watchlist active={active} onSelect={setActive} /></div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
          <div className="flex items-baseline gap-3">
            <div className="text-base font-semibold">{current.symbol}</div>
            <div className="text-xs text-muted-foreground">{current.name} · NSE</div>
          </div>
          <div className="flex items-baseline gap-4">
            <div className="font-mono tabular text-xl font-semibold">{current.price.toFixed(2)}</div>
            <div className={`font-mono tabular text-sm ${current.change >= 0 ? "text-bull" : "text-bear"}`}>
              {current.change >= 0 ? "+" : ""}{current.change.toFixed(2)} ({current.changePct.toFixed(2)}%)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1.5 text-xs">
          {INTERVALS.map((i) => (
            <button key={i} onClick={() => setInterval(i)} className={`rounded px-2 py-1 ${interval === i ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{i}</button>
          ))}
          <div className="mx-2 h-4 w-px bg-border" />
          {["Candles", "Line", "Area"].map((t, idx) => (
            <button key={t} className={`rounded px-2 py-1 ${idx === 0 ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
          <div className="mx-2 h-4 w-px bg-border" />
          {["Indicators", "Compare", "Alert"].map((t) => (
            <button key={t} className="rounded px-2 py-1 text-muted-foreground hover:text-foreground">{t}</button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11px] font-mono tabular text-muted-foreground">
            <span>O <span className="text-foreground">{candles[candles.length - 1].o.toFixed(2)}</span></span>
            <span>H <span className="text-bull">{candles[candles.length - 1].h.toFixed(2)}</span></span>
            <span>L <span className="text-bear">{candles[candles.length - 1].l.toFixed(2)}</span></span>
            <span>C <span className="text-foreground">{candles[candles.length - 1].c.toFixed(2)}</span></span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <CandlestickChart data={candles} height={420} />
        </div>

        <div className="border-t border-border bg-panel">
          <div className="flex items-center gap-4 border-b border-border px-4 text-xs">
            {["Positions", "Orders", "Holdings", "Funds"].map((t, i) => (
              <button key={t} className={`border-b-2 py-2 ${i === 0 ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-2 text-left">Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg</th><th className="text-right">LTP</th><th className="px-4 text-right">P&L</th></tr>
              </thead>
              <tbody>
                {POSITIONS.map((p) => (
                  <tr key={p.symbol} className="border-t border-border hover:bg-accent/50">
                    <td className="px-4 py-2 font-medium">{p.symbol}</td>
                    <td className="text-right font-mono tabular">{p.qty}</td>
                    <td className="text-right font-mono tabular">{p.avg.toFixed(2)}</td>
                    <td className="text-right font-mono tabular">{p.ltp.toFixed(2)}</td>
                    <td className={`px-4 text-right font-mono tabular ${p.pnl >= 0 ? "text-bull" : "text-bear"}`}>{p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-l border-border"><OrderPanel symbol={current.symbol} price={current.price} /></div>
    </div>
  );
}
