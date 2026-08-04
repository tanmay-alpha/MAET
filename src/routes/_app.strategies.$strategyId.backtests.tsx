import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  FlaskConical, Plus, Clock, CheckCircle, XCircle,
  Loader2, BarChart3, TrendingDown, TrendingUp,
  GitBranch, AlertCircle, RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/strategies/$strategyId/backtests")({
  head: () => ({ meta: [{ title: "Backtests — MAET Strategy Lab" }] }),
  component: StrategyBacktestsPage,
});

function StrategyBacktestsPage() {
  const { strategyId } = Route.useParams();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: stratData } = trpc.strategyDefinitions.get.useQuery({ strategyId });
  const { data: jobsData, refetch } = trpc.strategyBacktests.listJobs.useQuery({ limit: 20 });
  const jobs = (jobsData?.jobs ?? []).filter((j: any) => j.strategyVersionId);

  const { data: perfData } = trpc.strategyBacktests.getPerformance.useQuery(
    { jobId: selectedJobId! },
    { enabled: !!selectedJobId },
  );
  const { data: tradesData } = trpc.strategyBacktests.getTrades.useQuery(
    { jobId: selectedJobId! },
    { enabled: !!selectedJobId },
  );
  const { data: equityData } = trpc.strategyBacktests.getEquityCurve.useQuery(
    { jobId: selectedJobId! },
    { enabled: !!selectedJobId },
  );

  const cancelMutation = trpc.strategyBacktests.cancelJob.useMutation({
    onSuccess: () => refetch(),
  });

  const strategyName = stratData?.strategy?.name ?? "Strategy";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-semibold">Backtests</h1>
            <p className="text-xs text-muted-foreground">{strategyName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
          <Link
            to="/strategies/$strategyId"
            params={{ strategyId }}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Editor →
          </Link>
          <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            <Plus className="h-3.5 w-3.5" />
            Run New Backtest
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Job list */}
        <div className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0">
          {jobs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              No backtest runs yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {jobs.map((job: any) => (
                <BacktestJobCard
                  key={job.id}
                  job={job}
                  selected={selectedJobId === job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  onCancel={() => cancelMutation.mutate({ jobId: job.id })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {selectedJobId && perfData?.snapshot ? (
            <BacktestDetail
              snapshot={perfData.snapshot}
              trades={tradesData?.trades ?? []}
              equityPoints={equityData?.points ?? []}
            />
          ) : selectedJobId ? (
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
              {perfData?.snapshot === null ? "Backtest in progress or no results yet" : "Loading..."}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center">
              <div className="text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Select a run to view results</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BacktestJobCard({ job, selected, onClick, onCancel }: {
  job: any; selected: boolean; onClick: () => void; onCancel: () => void;
}) {
  const statusIcon = {
    QUEUED: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
    RUNNING: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />,
    COMPLETED: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />,
    FAILED: <XCircle className="h-3.5 w-3.5 text-bear" />,
    CANCELLED: <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />,
  }[job.status as string] ?? null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-primary/10" : "border-border hover:border-border/80"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {statusIcon}
        <span className="text-xs font-medium truncate">{job.symbolOrUniverse}</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{job.timeframe}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        {new Date(job.requestedAt).toLocaleDateString()}
      </div>
      {job.status === "RUNNING" && (
        <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${job.progress}%` }} />
        </div>
      )}
      {(job.status === "QUEUED" || job.status === "RUNNING") && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          className="mt-1.5 text-[10px] text-muted-foreground/60 hover:text-bear transition-colors"
        >
          Cancel
        </button>
      )}
    </button>
  );
}

function BacktestDetail({ snapshot, trades, equityPoints }: {
  snapshot: any;
  trades: any[];
  equityPoints: any[];
}) {
  const metrics = [
    { label: "Total Return", value: formatPercent(snapshot.totalReturn), positive: Number(snapshot.totalReturn) >= 0 },
    { label: "Ann. Return", value: formatPercent(snapshot.annualizedReturn), positive: Number(snapshot.annualizedReturn) >= 0 },
    { label: "Max Drawdown", value: formatPercent(snapshot.maxDrawdown), positive: false, negative: true },
    { label: "Sharpe", value: fmtNum(snapshot.sharpe, 2) },
    { label: "Sortino", value: fmtNum(snapshot.sortino, 2) },
    { label: "Calmar", value: fmtNum(snapshot.calmar, 2) },
    { label: "Win Rate", value: formatPercent(snapshot.winRate) },
    { label: "Profit Factor", value: fmtNum(snapshot.profitFactor, 2) },
    { label: "Expectancy", value: formatPercent(snapshot.expectancy) },
    { label: "Trades", value: String(snapshot.tradeCount ?? 0) },
    { label: "Fees Paid", value: `₹${fmtNum(snapshot.feesPaid, 0)}` },
    { label: "Net Profit", value: `₹${fmtNum(snapshot.netProfit, 0)}`, positive: Number(snapshot.netProfit) >= 0 },
  ];

  return (
    <div className="space-y-5">
      {/* Engine metadata */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
        <span>Engine v{snapshot.engineVersion}</span>
        <span>·</span>
        <span>{snapshot.executionPolicy}</span>
        <span>·</span>
        <span>{snapshot.intrabarPolicy}</span>
        <span>·</span>
        <span className="truncate">Data hash: {snapshot.dataHash?.slice(0, 10)}…</span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-panel p-3">
            <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
            <div className={`font-mono text-sm font-medium ${
              m.positive === true ? "text-bull" : m.negative ? "text-bear" : "text-foreground"
            }`}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Trade table */}
      {trades.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Trades ({trades.length})</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-panel border-b border-border">
                <tr>
                  {["Dir", "Entry Price", "Exit Price", "PnL", "Return", "Bars", "Exit Reason"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trades.slice(0, 50).map((t: any) => (
                  <tr key={t.id} className="hover:bg-panel/60">
                    <td className="px-3 py-2">
                      <span className={t.direction === "LONG" ? "text-bull" : "text-bear"}>{t.direction}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">₹{fmtNum(t.entryPrice, 2)}</td>
                    <td className="px-3 py-2 font-mono">₹{fmtNum(t.exitPrice, 2)}</td>
                    <td className={`px-3 py-2 font-mono ${Number(t.netPnl) >= 0 ? "text-bull" : "text-bear"}`}>
                      ₹{fmtNum(t.netPnl, 0)}
                    </td>
                    <td className={`px-3 py-2 font-mono ${Number(t.returnPercent) >= 0 ? "text-bull" : "text-bear"}`}>
                      {fmtNum(t.returnPercent, 2)}%
                    </td>
                    <td className="px-3 py-2">{t.holdingBars}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.length > 50 && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                Showing first 50 of {trades.length} trades
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground border-t border-border pt-3">
        Backtests are simulations for research purposes only. Past results do not predict future performance. Paper trading only.
      </div>
    </div>
  );
}

function formatPercent(val: string | number | null): string {
  if (val == null) return "—";
  return `${(Number(val) * 100).toFixed(2)}%`;
}

function fmtNum(val: string | number | null, decimals: number): string {
  if (val == null) return "—";
  return Number(val).toFixed(decimals);
}
