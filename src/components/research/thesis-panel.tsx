import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { BookOpen, Plus, ShieldCheck, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface ThesisPanelProps {
  symbol: string;
  exchange?: string;
  price?: number;
}

export function ThesisPanel({ symbol, exchange = "NSE", price }: ThesisPanelProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState(`${symbol} Setup Hypothesis`);
  const [setupType, setSetupType] = useState("Breakout");
  const [direction, setDirection] = useState<"LONG" | "SHORT" | "WATCH">("LONG");
  const [hypothesis, setHypothesis] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const thesesQuery = (trpc as any).tradeTheses.list.useQuery();
  const createThesisMutation = (trpc as any).tradeTheses.create.useMutation();

  const activeTheses = (thesesQuery.data || []).filter((t: any) => t.symbol === symbol);

  const handleCreate = async () => {
    if (!hypothesis) {
      setMessage("Please enter setup hypothesis.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      await createThesisMutation.mutateAsync({
        symbol,
        exchange: exchange as any,
        title,
        setupType,
        direction,
        hypothesis,
        stopPrice: stopPrice ? parseFloat(stopPrice) : undefined,
        targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
      });
      setMessage("Trade thesis created successfully!");
      void thesesQuery.refetch();
      setTimeout(() => {
        setShowCreateModal(false);
        setHypothesis("");
      }, 1000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create thesis";
      setMessage(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel border-l border-border">
      <div className="flex items-center justify-between border-b border-border p-2.5">
        <div className="flex items-center gap-1.5 font-bold text-xs">
          <BookOpen className="h-4 w-4 text-primary" />
          <span>Trade Thesis ({symbol})</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3 w-3" /> New Thesis
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {activeTheses.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 space-y-2">
            <BookOpen className="h-8 w-8 mx-auto opacity-30" />
            <p className="text-xs">No active trade thesis for {symbol}.</p>
            <p className="text-[10px] text-muted-foreground">Document your hypothesis, risk levels, and setups before trading.</p>
          </div>
        ) : (
          activeTheses.map((t: any) => (
            <div key={t.id} className="rounded-lg border border-border bg-panel-elevated p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  t.direction === "LONG" ? "bg-bull/15 text-bull" : t.direction === "SHORT" ? "bg-bear/15 text-bear" : "bg-purple-500/15 text-purple-400"
                }`}>
                  {t.direction === "LONG" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {t.direction}
                </span>
                <span className="text-[10px] font-mono uppercase text-muted-foreground">{t.status}</span>
              </div>
              <div className="font-semibold text-sm">{t.title}</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t.hypothesis}</p>
              {(t.stopPrice || t.targetPrice) && (
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono border-t border-border/50 pt-2 text-muted-foreground">
                  <div>Stop: <strong className="text-bear">₹{t.stopPrice || "—"}</strong></div>
                  <div>Target: <strong className="text-bull">₹{t.targetPrice || "—"}</strong></div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-bold text-sm">Create Trade Thesis</span>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">Close</button>
            </div>

            <div>
              <label className="text-[10px] uppercase font-semibold text-muted-foreground">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-semibold text-muted-foreground">Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as any)}
                  className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                  <option value="WATCH">WATCH</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold text-muted-foreground">Setup Type</label>
                <input
                  type="text"
                  value={setupType}
                  onChange={(e) => setSetupType(e.target.value)}
                  placeholder="e.g. Momentum, Reversal"
                  className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-semibold text-muted-foreground">Hypothesis & Edge</label>
              <textarea
                rows={3}
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                placeholder="Describe your reasoning, key technical levels, and catalyst..."
                className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-sans text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-semibold text-muted-foreground">Stop Loss Price (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold text-muted-foreground">Target Price (₹)</label>
                <input
                  type="number"
                  step="0.05"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded bg-panel-elevated px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleCreate}
              disabled={isSubmitting}
              className="w-full rounded bg-primary py-2.5 font-bold text-primary-foreground text-xs hover:opacity-95 transition disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Save Trade Thesis"}
            </button>

            {message && (
              <div className={`rounded p-2 text-[11px] ${message.includes("success") ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"}`}>
                {message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
