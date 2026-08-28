import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { trpc } from "@/lib/trpc";
import { BookOpen, Award, AlertTriangle, CheckCircle2, FileText, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({
    meta: [
      { title: "Research Journal & Trade Review — MAET" },
      { name: "description", content: "Review open theses, closed trades, execution performance, and trade journals." },
    ],
  }),
  component: JournalPage,
});

function JournalPage() {
  const [activeTab, setActiveTab] = useState<"THEASES" | "REVIEWS">("THEASES");
  const thesesQuery = trpc.tradeTheses.list.useQuery();
  const { positions } = usePaperAccount();

  const theses = thesesQuery.data || [];
  const closedPositions = positions.filter((position) => position.totalShares === 0);

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <span>Research Journal & Trade Review</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Evaluate setup hypotheses, execution adherence, and post-trade performance metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("THEASES")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "THEASES" ? "bg-primary text-primary-foreground" : "bg-panel border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Trade Theses ({theses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("REVIEWS")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "REVIEWS" ? "bg-primary text-primary-foreground" : "bg-panel border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Closed Trade Reviews ({closedPositions.length})
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4 text-xs font-mono">
        <div className="rounded-lg border border-border bg-panel p-4 space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase">Total Theses</div>
          <div className="text-xl font-bold text-foreground">{theses.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-4 space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase">Active Setups</div>
          <div className="text-xl font-bold text-bull">{theses.filter((t: any) => t.status === "ACTIVE" || t.status === "PLANNED").length}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-4 space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase">Closed Trade Fills</div>
          <div className="text-xl font-bold text-foreground">{closedPositions.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-4 space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase">Win Rate (Review)</div>
          <div className="text-xl font-bold text-muted-foreground">—</div>
          <div className="text-[10px] text-muted-foreground">Unavailable until review outcomes are recorded.</div>
        </div>
      </div>

      {/* Main Content */}
      {activeTab === "THEASES" ? (
        <div className="space-y-3">
          <h2 className="text-sm font-bold">Recorded Trade Theses</h2>
          {theses.length === 0 ? (
            <div className="rounded-lg border border-border bg-panel p-12 text-center text-muted-foreground space-y-2">
              <FileText className="h-8 w-8 mx-auto opacity-30" />
              <p className="text-sm">No trade theses recorded yet.</p>
              <p className="text-xs">Create a thesis directly from the Screener or Terminal workspace.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {theses.map((t: any) => (
                <div key={t.id} className="rounded-lg border border-border bg-panel p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.direction === "LONG" ? "bg-bull/15 text-bull" : t.direction === "SHORT" ? "bg-bear/15 text-bear" : "bg-purple-500/15 text-purple-400"
                      }`}>
                        {t.direction}
                      </span>
                      <span className="font-bold text-sm">{t.symbol}</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase text-muted-foreground">{t.status}</span>
                  </div>
                  <div className="font-semibold text-xs text-foreground">{t.title}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{t.hypothesis}</p>
                  {(t.stopPrice || t.targetPrice) && (
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono border-t border-border/50 pt-2 text-muted-foreground">
                      <div>Stop: <strong className="text-bear">₹{t.stopPrice || "—"}</strong></div>
                      <div>Target: <strong className="text-bull">₹{t.targetPrice || "—"}</strong></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-bold">Closed Positions & Trade Performance</h2>
          {closedPositions.length === 0 ? (
            <div className="rounded-lg border border-border bg-panel p-12 text-center text-muted-foreground space-y-2">
              <Award className="h-8 w-8 mx-auto opacity-30" />
              <p className="text-sm">No closed paper trading positions to review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {closedPositions.map((pos: any) => (
                <div key={pos.symbol} className="rounded-lg border border-border bg-panel p-4 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-sm">{pos.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">Realized P&L: <span className={pos.realizedPnl >= 0 ? "text-bull font-bold" : "text-bear font-bold"}>₹{pos.realizedPnl.toFixed(2)}</span></div>
                  </div>
                  <button type="button" className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground text-xs">
                    Write Review
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
