import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Play, Pause, SkipForward, RotateCcw, X,
  ChevronRight, BarChart3, Clock, DollarSign,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/replay")({
  head: () => ({ meta: [{ title: "Bar Replay — MAET Strategy Lab" }] }),
  component: ReplayPage,
});

function ReplayPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState("2023-01-01T00:00:00.000Z");

  const { data: sessions, refetch: refetchSessions } = trpc.strategyReplay.list.useQuery();

  const createMutation = trpc.strategyReplay.create.useMutation({
    onSuccess: (data: any) => {
      setActiveSessionId(data.session.id);
      refetchSessions();
    },
  });

  const stepMutation = trpc.strategyReplay.step.useMutation();
  const resetMutation = trpc.strategyReplay.reset.useMutation();
  const closeMutation = trpc.strategyReplay.close.useMutation({
    onSuccess: () => { setActiveSessionId(null); refetchSessions(); },
  });

  const { data: stateData, refetch: refetchState } = trpc.strategyReplay.getState.useQuery(
    { sessionId: activeSessionId! },
    { enabled: !!activeSessionId },
  );

  const bars = stateData?.bars ?? [];
  const session = stateData?.session;

  function handleStep() {
    if (!activeSessionId) return;
    stepMutation.mutate({ sessionId: activeSessionId }, {
      onSuccess: () => refetchState(),
    });
  }

  function handleReset() {
    if (!activeSessionId) return;
    resetMutation.mutate({ sessionId: activeSessionId }, {
      onSuccess: () => refetchState(),
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Play className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">Bar Replay</h1>
          <span className="text-[10px] rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary uppercase tracking-wide">
            Isolated Account
          </span>
        </div>
        {activeSessionId && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleStep}
              disabled={stepMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Next Bar
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
            <button
              onClick={() => closeMutation.mutate({ sessionId: activeSessionId })}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-bear"
            >
              <X className="h-3.5 w-3.5" />
              Close Session
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-64 border-r border-border flex-shrink-0 overflow-y-auto p-4 space-y-4">
          {/* New session form */}
          {!activeSessionId && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Session</div>
              <div>
                <label className="text-xs text-muted-foreground">Symbol</label>
                <input
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="RELIANCE"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Timeframe</label>
                <select
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  {["1m", "5m", "15m", "1h", "1d"].map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Start Date</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
                  value={startDate.split("T")[0]}
                  onChange={(e) => setStartDate(`${e.target.value}T00:00:00.000Z`)}
                />
              </div>
              <button
                onClick={() => createMutation.mutate({ symbol, timeframe, startTimestamp: startDate })}
                disabled={createMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {createMutation.isPending ? "Starting..." : "Start Replay"}
              </button>
            </div>
          )}

          {/* Session info */}
          {session && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Session</div>
              <div className="rounded-lg border border-border bg-panel p-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-mono">{session.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeframe</span>
                  <span className="font-mono">{session.timeframe}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bars revealed</span>
                  <span className="font-mono">{session.barsRevealed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equity</span>
                  <span className="font-mono">₹{Number(session.currentEquity).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Past sessions */}
          {(sessions?.sessions?.length ?? 0) > 0 && !activeSessionId && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Sessions</div>
              {sessions?.sessions.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className="w-full text-left rounded border border-border p-2.5 hover:border-primary/50 transition-colors"
                >
                  <div className="text-xs font-mono font-medium">{s.symbol} · {s.timeframe}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{s.barsRevealed} bars revealed</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main area — bar list */}
        <div className="flex-1 overflow-y-auto p-4">
          {bars.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground mb-1">No bars revealed yet</p>
                <p className="text-xs text-muted-foreground">
                  {activeSessionId ? 'Press "Next Bar" to reveal the first bar' : "Start a new replay session"}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="mb-3 flex items-center gap-2">
                <div className="text-sm font-medium">{bars.length} bars revealed</div>
                <div className="text-xs text-muted-foreground">
                  through {new Date(bars[bars.length - 1]?.ts).toLocaleDateString()}
                </div>
              </div>

              {/* Bar table — most recent first */}
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-panel border-b border-border sticky top-0">
                    <tr>
                      {["#", "Date/Time", "Open", "High", "Low", "Close", "Volume", "Change%"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...bars].reverse().map((bar: any, i: number) => {
                      const changePct = i < bars.length - 1
                        ? ((bar.close - [...bars].reverse()[i + 1].close) / [...bars].reverse()[i + 1].close * 100)
                        : 0;
                      const isUp = bar.close >= bar.open;
                      return (
                        <tr key={bar.ts} className={`hover:bg-panel/60 ${i === 0 ? "bg-primary/5" : ""}`}>
                          <td className="px-3 py-2 text-muted-foreground">{bars.length - i}</td>
                          <td className="px-3 py-2 font-mono">{new Date(bar.ts).toLocaleDateString()}</td>
                          <td className="px-3 py-2 font-mono">₹{bar.open.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono text-bull">₹{bar.high.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono text-bear">₹{bar.low.toFixed(2)}</td>
                          <td className={`px-3 py-2 font-mono font-medium ${isUp ? "text-bull" : "text-bear"}`}>
                            ₹{bar.close.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {(bar.volume / 1000).toFixed(0)}K
                          </td>
                          <td className={`px-3 py-2 font-mono ${changePct >= 0 ? "text-bull" : "text-bear"}`}>
                            {changePct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
