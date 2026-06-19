import { createFileRoute } from "@tanstack/react-router";
import { POSITIONS, ORDERS, INDICES, equityCurve, STRATEGIES } from "@/lib/mock-data";
import { ArrowDownRight, ArrowUpRight, Activity, Wallet, TrendingUp, Cpu } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — MAET" }] }),
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, sub, trend }: { icon: any; label: string; value: string; sub: string; trend: "up" | "down" | "flat" }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold font-mono tabular">{value}</div>
      <div className={`mt-1 flex items-center gap-1 text-xs font-mono tabular ${trend === "up" ? "text-bull" : trend === "down" ? "text-bear" : "text-muted-foreground"}`}>
        {trend === "up" && <ArrowUpRight className="h-3 w-3" />}
        {trend === "down" && <ArrowDownRight className="h-3 w-3" />}
        {sub}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: { x: number; y: number }[] }) {
  const min = Math.min(...data.map((d) => d.y));
  const max = Math.max(...data.map((d) => d.y));
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${100 - ((d.y - min) / (max - min)) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="eq" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,100 ${pts} 100,100`} fill="url(#eq)" stroke="none" />
      <polyline points={pts} fill="none" stroke="var(--color-primary)" strokeWidth="0.6" />
    </svg>
  );
}

function Dashboard() {
  const curve = useMemo(() => equityCurve(60), []);
  const totalPnl = POSITIONS.reduce((a, p) => a + p.pnl, 0);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Good morning, Tanmay</h1>
          <p className="text-xs text-muted-foreground">Markets opened 1h 24m ago · NIFTY +0.58%</p>
        </div>
        <div className="hidden gap-2 md:flex">
          <button className="rounded-md border border-border bg-panel px-3 py-1.5 text-xs hover:bg-accent">Export</button>
          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">+ New strategy</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Wallet} label="Portfolio value" value="₹12,48,532" sub="+₹18,420 today" trend="up" />
        <StatCard icon={Activity} label="Day P&L" value={`₹${totalPnl.toLocaleString("en-IN")}`} sub={totalPnl >= 0 ? "+1.42%" : "-0.84%"} trend={totalPnl >= 0 ? "up" : "down"} />
        <StatCard icon={TrendingUp} label="Realized" value="₹52,810" sub="+12.4% MTD" trend="up" />
        <StatCard icon={Cpu} label="Active algos" value="4" sub="2 profitable" trend="flat" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Equity curve</div>
              <div className="text-xs text-muted-foreground">Last 60 sessions</div>
            </div>
            <div className="flex gap-1 text-xs">
              {["1W", "1M", "3M", "1Y", "ALL"].map((p) => (
                <button key={p} className={`rounded px-2 py-1 ${p === "1M" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>
              ))}
            </div>
          </div>
          <div className="h-64 p-2"><Sparkline data={curve} /></div>
        </div>

        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Indices</div>
          <div className="divide-y divide-border">
            {INDICES.map((i) => (
              <div key={i.symbol} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <div className="font-medium">{i.symbol}</div>
                <div className="text-right">
                  <div className="font-mono tabular">{i.price.toLocaleString("en-IN")}</div>
                  <div className={`font-mono tabular text-[10px] ${i.change >= 0 ? "text-bull" : "text-bear"}`}>
                    {i.change >= 0 ? "+" : ""}{i.changePct.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Open positions</div>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg</th><th className="text-right">LTP</th><th className="px-4 text-right">P&L</th></tr>
            </thead>
            <tbody>
              {POSITIONS.map((p) => (
                <tr key={p.symbol} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{p.symbol}</td>
                  <td className="text-right font-mono tabular">{p.qty}</td>
                  <td className="text-right font-mono tabular">{p.avg.toFixed(2)}</td>
                  <td className="text-right font-mono tabular">{p.ltp.toFixed(2)}</td>
                  <td className={`px-4 text-right font-mono tabular ${p.pnl >= 0 ? "text-bull" : "text-bear"}`}>{p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Recent orders</div>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Time</th><th className="text-left">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="px-4 text-right">Status</th></tr>
            </thead>
            <tbody>
              {ORDERS.map((o, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono tabular text-muted-foreground">{o.time}</td>
                  <td className="font-medium">{o.symbol}</td>
                  <td className="text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.side === "BUY" ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"}`}>{o.side}</span>
                  </td>
                  <td className="text-right font-mono tabular">{o.qty}</td>
                  <td className="text-right font-mono tabular">{o.price.toFixed(2)}</td>
                  <td className={`px-4 text-right ${o.status === "Filled" ? "text-bull" : "text-muted-foreground"}`}>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-panel">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Algorithm performance</div>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-4 py-2 text-left">Strategy</th><th className="text-left">Asset</th><th>Status</th><th className="text-right">Trades</th><th className="text-right">Win%</th><th className="text-right">Sharpe</th><th className="px-4 text-right">P&L</th></tr>
          </thead>
          <tbody>
            {STRATEGIES.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2.5 font-medium">{s.name}</td>
                <td className="text-muted-foreground">{s.asset}</td>
                <td className="text-center">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.status === "Live" ? "bg-bull/20 text-bull" : s.status === "Paused" ? "bg-bear/20 text-bear" : "bg-primary/20 text-primary"}`}>{s.status}</span>
                </td>
                <td className="text-right font-mono tabular">{s.trades}</td>
                <td className="text-right font-mono tabular">{s.winRate}%</td>
                <td className="text-right font-mono tabular">{s.sharpe.toFixed(2)}</td>
                <td className={`px-4 text-right font-mono tabular ${s.pnl >= 0 ? "text-bull" : "text-bear"}`}>{s.pnl >= 0 ? "+" : ""}₹{s.pnl.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
