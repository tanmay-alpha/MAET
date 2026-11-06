import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { X } from "lucide-react";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useSignedIn } from "@/hooks/use-signed-in";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { trpc } from "@/lib/trpc";
import type { PaperPositionRow } from "../../server/modules/paper-trading/contracts";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({
    meta: [
      { title: "Journal — MAET" },
      { name: "description", content: "Trade theses and reviews of closed paper trades." },
    ],
  }),
  component: JournalPage,
});

/** The fields of a `tradeTheses.list` row this page reads (server/db/schema.ts tradeTheses). */
interface ThesisRow {
  id: string;
  symbol: string;
  title: string;
  direction: string;
  hypothesis: string;
  status: string;
  stopPrice: string | null;
  targetPrice: string | null;
}

interface Review {
  outcome: string;
  discipline: string;
  notes: string;
}

const OUTCOMES = [
  { value: "AS_PLANNED", label: "Followed the plan" },
  { value: "EARLY_EXIT", label: "Exited early" },
  { value: "VIOLATED_STOP", label: "Ignored the stop" },
  { value: "CHASED_ENTRY", label: "Chased the entry" },
  { value: "OVERSIZED", label: "Position too large" },
];

const DISCIPLINE = [
  { value: "DISCIPLINED", label: "Calm" },
  { value: "ANXIOUS", label: "Anxious or hesitant" },
  { value: "EUPHORIC", label: "Overconfident" },
  { value: "FRUSTRATED", label: "Frustrated or impatient" },
];

const DIRECTION_CLASS: Record<string, string> = {
  LONG: "text-bull",
  SHORT: "text-bear",
};

function rupees(value: number | string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedRupees(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${rupees(Math.abs(value))}`;
}

function JournalPage() {
  const [activeTab, setActiveTab] = useState<"THESES" | "REVIEWS">("THESES");
  const signedIn = useSignedIn();
  const thesesQuery = trpc.tradeTheses.list.useQuery(undefined, { enabled: signedIn });
  const { positions, connectionState } = usePaperAccount();

  const theses: ThesisRow[] = thesesQuery.data ?? [];
  const activeTheses = theses.filter((t) => t.status === "ACTIVE" || t.status === "PLANNED").length;
  const closedPositions = positions.filter((position) => position.totalShares === 0);

  const [reviewModalPos, setReviewModalPos] = useState<PaperPositionRow | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState("AS_PLANNED");
  const [reviewDiscipline, setReviewDiscipline] = useState("DISCIPLINED");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewedSymbols, setReviewedSymbols] = useState<Record<string, Review>>({});

  const tabClass = (active: boolean) =>
    `px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Journal</h1>
        {signedIn && (
          <>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {activeTheses} active of {theses.length} theses
            </span>
            <div className="ml-auto flex overflow-hidden rounded border border-border" role="group" aria-label="Journal view">
              <button type="button" aria-pressed={activeTab === "THESES"} onClick={() => setActiveTab("THESES")} className={tabClass(activeTab === "THESES")}>
                Theses <span className="font-mono tabular-nums">{theses.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={activeTab === "REVIEWS"}
                onClick={() => setActiveTab("REVIEWS")}
                className={`border-l border-border ${tabClass(activeTab === "REVIEWS")}`}
              >
                Closed trades <span className="font-mono tabular-nums">{closedPositions.length}</span>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="space-y-3 p-4 sm:p-5">
        {!signedIn ? (
          <SignedOutNotice feature="Trade theses and reviews" />
        ) : activeTab === "THESES" ? (
          thesesQuery.isError ? (
            <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Trade theses could not be loaded right now.
            </p>
          ) : thesesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading theses…</p>
          ) : theses.length === 0 ? (
            <p className="rounded border border-border bg-panel px-3 py-4 text-xs text-muted-foreground">No trade theses yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {theses.map((t) => (
                <article key={t.id} className="space-y-2 rounded border border-border bg-panel p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold">{t.symbol}</span>
                    <span className={`font-mono text-[11px] font-semibold ${DIRECTION_CLASS[t.direction] ?? "text-muted-foreground"}`}>{t.direction}</span>
                    <span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">{t.status}</span>
                  </div>
                  <h2 className="text-sm font-medium">{t.title}</h2>
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{t.hypothesis}</p>
                  {(t.stopPrice || t.targetPrice) && (
                    <dl className="flex gap-4 border-t border-border/60 pt-2 font-mono text-xs tabular-nums">
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Stop</dt>
                        <dd className="text-bear">{rupees(t.stopPrice)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Target</dt>
                        <dd className="text-bull">{rupees(t.targetPrice)}</dd>
                      </div>
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )
        ) : connectionState === "disconnected" ? (
          <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            The paper account could not be loaded, so closed trades are unavailable right now.
          </p>
        ) : closedPositions.length === 0 ? (
          <p className="rounded border border-border bg-panel px-3 py-4 text-xs text-muted-foreground">No closed paper trades to review yet.</p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">Reviews stay on this page only; they are not saved to your account and clear on reload.</p>
            <ul className="divide-y divide-border rounded border border-border bg-panel">
              {closedPositions.map((pos) => {
                const existingReview = reviewedSymbols[pos.symbol];
                const realized = Number(pos.realizedPnl);
                return (
                  <li key={pos.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{pos.symbol}</span>
                        <span className={`font-mono tabular-nums ${realized >= 0 ? "text-bull" : "text-bear"}`}>{signedRupees(realized)}</span>
                        {existingReview && <span className="text-[11px] text-muted-foreground">Reviewed</span>}
                      </div>
                      {existingReview?.notes && <p className="line-clamp-1 text-[11px] text-muted-foreground">{existingReview.notes}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewModalPos(pos);
                        setReviewOutcome(existingReview?.outcome ?? "AS_PLANNED");
                        setReviewDiscipline(existingReview?.discipline ?? "DISCIPLINED");
                        setReviewNotes(existingReview?.notes ?? "");
                      }}
                      className="shrink-0 rounded border border-border px-2.5 py-1 text-xs hover:bg-accent"
                    >
                      {existingReview ? "Edit review" : "Review"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {reviewModalPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="journal-review-title">
          <div className="w-full max-w-md space-y-3 rounded border border-border bg-panel p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="journal-review-title" className="text-sm font-semibold">
                  Review {reviewModalPos.symbol}
                </h2>
                <p className="mt-0.5 font-mono tabular-nums text-muted-foreground">
                  Realised P&L{" "}
                  <span className={Number(reviewModalPos.realizedPnl) >= 0 ? "text-bull" : "text-bear"}>
                    {signedRupees(Number(reviewModalPos.realizedPnl))}
                  </span>
                </p>
              </div>
              <button type="button" onClick={() => setReviewModalPos(null)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close review">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-muted-foreground">Outcome</span>
              <select
                value={reviewOutcome}
                onChange={(e) => setReviewOutcome(e.target.value)}
                className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-hidden"
              >
                {OUTCOMES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-muted-foreground">State of mind</span>
              <select
                value={reviewDiscipline}
                onChange={(e) => setReviewDiscipline(e.target.value)}
                className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-hidden"
              >
                {DISCIPLINE.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-muted-foreground">Notes</span>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                className="w-full resize-none rounded border border-border bg-background p-2.5 text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
              />
            </label>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <button type="button" onClick={() => setReviewModalPos(null)} className="rounded border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewedSymbols((prev) => ({
                    ...prev,
                    [reviewModalPos.symbol]: { outcome: reviewOutcome, discipline: reviewDiscipline, notes: reviewNotes.trim() },
                  }));
                  setReviewModalPos(null);
                }}
                className="rounded bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Keep review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
