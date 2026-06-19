import { STRATEGIES } from "@/lib/mock-data";
import { Play, Pause, Settings2, Plus } from "lucide-react";

export default function StrategiesPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Strategies</h1>
          <p className="text-xs text-muted-foreground">{STRATEGIES.filter((s) => s.status === "Live").length} live · {STRATEGIES.length} total</p>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> New strategy
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {STRATEGIES.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-panel p-4 transition hover:border-primary/40">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{s.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.type} · {s.asset}</div>
              </div>
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${s.status === "Live" ? "bg-bull/20 text-bull" : s.status === "Paused" ? "bg-bear/20 text-bear" : "bg-primary/20 text-primary"}`}>{s.status}</span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">P&L</div>
                <div className={`mt-0.5 font-mono tabular font-semibold ${s.pnl >= 0 ? "text-bull" : "text-bear"}`}>{s.pnl >= 0 ? "+" : ""}₹{s.pnl.toLocaleString("en-IN")}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Win rate</div>
                <div className="mt-0.5 font-mono tabular font-semibold">{s.winRate}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sharpe</div>
                <div className="mt-0.5 font-mono tabular font-semibold">{s.sharpe.toFixed(2)}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-panel-elevated px-2 py-1.5 text-xs hover:bg-accent">
                {s.status === "Live" ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Start</>}
              </button>
              <button className="flex items-center justify-center rounded-md bg-panel-elevated px-2 py-1.5 text-xs hover:bg-accent">
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
