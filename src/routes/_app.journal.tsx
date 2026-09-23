import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { trpc } from "@/lib/trpc";
import { BookOpen, Award, AlertTriangle, CheckCircle2, FileText, ArrowUpRight, ArrowDownRight, X, Check } from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<"THESES" | "REVIEWS">("THESES");
  const thesesQuery = trpc.tradeTheses.list.useQuery();
  const { positions } = usePaperAccount();

  const theses = thesesQuery.data || [];
  const closedPositions = positions.filter((position) => position.totalShares === 0);

  const [reviewModalPos, setReviewModalPos] = useState<any | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState("AS_PLANNED");
  const [reviewDiscipline, setReviewDiscipline] = useState("DISCIPLINED");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewedSymbols, setReviewedSymbols] = useState<Record<string, { outcome: string; discipline: string; notes: string }>>({});
  const [savedToast, setSavedToast] = useState<string | null>(null);

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
            onClick={() => setActiveTab("THESES")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "THESES" ? "bg-primary text-primary-foreground" : "bg-panel border border-border text-muted-foreground hover:text-foreground"
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
      {activeTab === "THESES" ? (
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
            {savedToast && (
              <div className="rounded-lg border border-bull/30 bg-bull/10 p-3 text-xs text-bull flex items-center justify-between">
                <span>{savedToast}</span>
                <button
                  type="button"
                  onClick={() => setSavedToast(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {closedPositions.length === 0 ? (
              <div className="rounded-lg border border-border bg-panel p-12 text-center text-muted-foreground space-y-2">
                <Award className="h-8 w-8 mx-auto opacity-30" />
                <p className="text-sm">No closed paper trading positions to review.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {closedPositions.map((pos: any) => {
                  const existingReview = reviewedSymbols[pos.symbol];
                  return (
                    <div key={pos.symbol} className="rounded-lg border border-border bg-panel p-4 flex items-center justify-between text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{pos.symbol}</span>
                          {existingReview && (
                            <span className="inline-flex items-center gap-1 rounded bg-bull/15 px-2 py-0.5 text-[10px] font-semibold text-bull">
                              <Check className="h-3 w-3" /> Reviewed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Realized P&L:{" "}
                          <span className={pos.realizedPnl >= 0 ? "text-bull font-bold" : "text-bear font-bold"}>
                            ₹{pos.realizedPnl.toFixed(2)}
                          </span>
                        </div>
                        {existingReview?.notes && (
                          <p className="text-[11px] text-muted-foreground italic line-clamp-1">
                            "{existingReview.notes}"
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReviewModalPos(pos);
                          setReviewOutcome(existingReview?.outcome || "AS_PLANNED");
                          setReviewDiscipline(existingReview?.discipline || "DISCIPLINED");
                          setReviewNotes(existingReview?.notes || "");
                        }}
                        className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground text-xs hover:bg-primary/90 transition"
                      >
                        {existingReview ? "Edit Review" : "Write Review"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      {/* Structured Trade Review Modal */}
      {reviewModalPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-panel p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Post-Trade Review: {reviewModalPos.symbol}</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Realized P&L:{" "}
                  <span className={reviewModalPos.realizedPnl >= 0 ? "text-bull font-semibold" : "text-bear font-semibold"}>
                    ₹{reviewModalPos.realizedPnl.toFixed(2)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewModalPos(null)}
                className="text-muted-foreground hover:text-foreground rounded p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">
                  Plan Adherence / Execution Outcome
                </label>
                <select
                  value={reviewOutcome}
                  onChange={(e) => setReviewOutcome(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-hidden focus:border-primary"
                >
                  <option value="AS_PLANNED">Executed Strictly as Planned</option>
                  <option value="EARLY_EXIT">Early Profit Taking / Fear</option>
                  <option value="VIOLATED_STOP">Violated Stop Loss / Hope</option>
                  <option value="CHASED_ENTRY">Chased Entry / FOMO</option>
                  <option value="OVERSIZED">Oversized Position / Risk Error</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">
                  Psychological & Emotional State
                </label>
                <select
                  value={reviewDiscipline}
                  onChange={(e) => setReviewDiscipline(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-hidden focus:border-primary"
                >
                  <option value="DISCIPLINED">Calm & Disciplined</option>
                  <option value="ANXIOUS">Anxious / Hesitant</option>
                  <option value="EUPHORIC">Overconfident / Euphoric</option>
                  <option value="FRUSTRATED">Frustrated / Impatient</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">
                  Trade Reflections & Notes
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="What went well? What would you do differently next time? Note market context..."
                  rows={3}
                  className="w-full rounded border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setReviewModalPos(null)}
                className="rounded border border-border px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewedSymbols((prev) => ({
                    ...prev,
                    [reviewModalPos.symbol]: {
                      outcome: reviewOutcome,
                      discipline: reviewDiscipline,
                      notes: reviewNotes.trim(),
                    },
                  }));
                  setSavedToast(`Trade review saved for ${reviewModalPos.symbol}`);
                  setReviewModalPos(null);
                }}
                className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90 transition"
              >
                Save Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
