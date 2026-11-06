import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  FlaskConical, Plus, Clock, CheckCircle, XCircle,
  Loader2, BarChart3, AlertCircle, RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { SweepRobustness } from "../../server/modules/strategy-optimisation/sweep-robustness";
import { RunJobDialog } from "@/components/strategy/run-job-dialog";
import { RobustnessHeatmapView } from "@/components/strategy/robustness-heatmap-view";
import { WalkForwardView } from "@/components/strategy/walk-forward-view";
import {
  backtestDisplayStatus,
  describeJobError,
  isActiveJob,
  jobPollInterval,
  JOB_KIND_FOR_TAB,
  parseResearchSearch,
  RESEARCH_TAB_FOR_KIND,
  sweepProgress,
  walkForwardError,
  walkForwardViewResult,
  type BacktestJobView,
  type JobKind,
  type ResearchTab,
  type SweepResultView,
  type SweepView,
  type WalkForwardRunView,
} from "@/lib/strategy-jobs";

export const Route = createFileRoute("/_app/strategies/$strategyId/backtests")({
  validateSearch: parseResearchSearch,
  head: () => ({ meta: [{ title: "Research — MAET Strategy Lab" }] }),
  component: StrategyBacktestsPage,
});

const TABS: Array<{ id: ResearchTab; label: string; newLabel: string }> = [
  { id: "backtests", label: "Backtests", newLabel: "Run New Backtest" },
  { id: "sweeps", label: "Parameter Sweeps", newLabel: "New Parameter Sweep" },
  { id: "walk-forward", label: "Walk-Forward", newLabel: "New Walk-Forward Test" },
];

function StrategyBacktestsPage() {
  const { strategyId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? "backtests";
  const selectedId = search.job ?? null;
  const [dialogKind, setDialogKind] = useState<JobKind | null>(null);

  const { data: stratData } = trpc.strategyDefinitions.get.useQuery({ strategyId });
  const versions: Array<{ id: string; versionNumber: number; definition: unknown }> = stratData?.versions ?? [];
  const strategyName = stratData?.strategy?.name ?? "Strategy";

  const select = (nextTab: ResearchTab, job?: string) =>
    navigate({ search: { tab: nextTab === "backtests" ? undefined : nextTab, job }, replace: true });

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-semibold">Research</h1>
            <p className="text-xs text-muted-foreground">{strategyName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                tab === t.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
          <Link
            to="/strategies/$strategyId"
            params={{ strategyId }}
            className="ml-2 flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Editor →
          </Link>
          <button
            onClick={() => setDialogKind(JOB_KIND_FOR_TAB[tab])}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            {activeTab.newLabel}
          </button>
        </div>
      </div>

      {tab === "backtests" && (
        <BacktestsTab versionIds={versions.map((v) => v.id)} selectedJobId={selectedId} onSelect={(id) => select("backtests", id)} />
      )}
      {tab === "sweeps" && <SweepsTab strategyId={strategyId} selectedId={selectedId} onSelect={(id) => select("sweeps", id)} />}
      {tab === "walk-forward" && (
        <WalkForwardTab strategyId={strategyId} selectedId={selectedId} onSelect={(id) => select("walk-forward", id)} />
      )}

      <RunJobDialog
        kind={dialogKind}
        onOpenChange={(open) => !open && setDialogKind(null)}
        strategyId={strategyId}
        version={versions[0]}
        onCreated={(kind, id) => {
          setDialogKind(null);
          select(RESEARCH_TAB_FOR_KIND[kind], id);
        }}
      />
    </div>
  );
}

// ============================================================
// Shared list chrome
// ============================================================

const STATUS_ICON: Record<string, React.ReactNode> = {
  QUEUED: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  RUNNING: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />,
  CANCELLING: <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />,
  COMPLETED: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />,
  FAILED: <XCircle className="h-3.5 w-3.5 text-bear" />,
  CANCELLED: <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />,
};

function JobListLayout({ list, detail, empty, onRefresh }: {
  list: React.ReactNode[];
  detail: React.ReactNode;
  empty: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0">
        <button
          onClick={onRefresh}
          className="mb-2 flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
        {list.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground text-center px-4">{empty}</div>
        ) : (
          <div className="space-y-1.5">{list}</div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">{detail}</div>
    </div>
  );
}

function JobCard({ selected, onClick, status, title, subtitle, meta, progress, onCancel }: {
  selected: boolean;
  onClick: () => void;
  status: string;
  title: string;
  subtitle: string;
  meta: string;
  progress?: number;
  onCancel?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
        selected ? "border-primary bg-primary/10" : "border-border hover:border-border/80"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {STATUS_ICON[status] ?? null}
        <span className="text-xs font-medium truncate">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{meta}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        {subtitle} · {status === "QUEUED" ? "waiting for the job runner" : status.toLowerCase()}
      </div>
      {status === "RUNNING" && progress !== undefined && (
        <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {onCancel && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          className="mt-1.5 text-[10px] text-muted-foreground/60 hover:text-bear transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function Placeholder({ icon = true, children }: { icon?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="text-center max-w-md">
        {icon && <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />}
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function FailureNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-bear/40 bg-bear/10 px-4 py-3 text-xs text-bear">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5">{message}</div>
      </div>
    </div>
  );
}

function CancelError({ error }: { error: Error | null }) {
  if (!error) return null;
  const info = describeJobError(error);
  return <div className="mb-3"><FailureNotice title={info.title} message={info.message} /></div>;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString();

// ============================================================
// Backtests
// ============================================================

function BacktestsTab({ versionIds, selectedJobId, onSelect }: {
  versionIds: string[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: jobsData, refetch } = trpc.strategyBacktests.listJobs.useQuery(
    { limit: 50 },
    { refetchInterval: (query: { state: { data?: { jobs: BacktestJobView[] } } }) => jobPollInterval((query.state.data?.jobs ?? []).map((j) => j.status)) },
  );
  // listJobs covers every strategy of the user; keep this strategy's versions.
  const jobs = (jobsData?.jobs ?? []).filter((j) => versionIds.includes(j.strategyVersionId));
  const selected = jobs.find((j) => j.id === selectedJobId) ?? null;
  const completed = selected?.status === "COMPLETED";

  const { data: perfData } = trpc.strategyBacktests.getPerformance.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const { data: tradesData } = trpc.strategyBacktests.getTrades.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const { data: equityData } = trpc.strategyBacktests.getEquityCurve.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const cancelMutation = trpc.strategyBacktests.cancelJob.useMutation({ onSuccess: () => refetch() });

  let detail: React.ReactNode;
  if (!selected) {
    detail = <Placeholder>Select a run to view results</Placeholder>;
  } else if (selected.status === "FAILED") {
    detail = <FailureNotice title={`Backtest failed (${selected.errorCode ?? "error"})`} message={selected.errorSummary ?? "No details were recorded."} />;
  } else if (selected.status === "CANCELLED") {
    detail = <Placeholder icon={false}>This backtest was cancelled.</Placeholder>;
  } else if (!completed) {
    detail = (
      <Placeholder>
        {selected.status === "QUEUED" ? "Queued: waiting for the job runner to pick it up." : `Running… ${selected.progress}%`}
      </Placeholder>
    );
  } else if (perfData?.snapshot) {
    detail = <BacktestDetail snapshot={perfData.snapshot} trades={tradesData?.trades ?? []} equityPoints={equityData?.points ?? []} />;
  } else {
    detail = <Placeholder icon={false}>{perfData ? "No stored results for this run." : "Loading…"}</Placeholder>;
  }

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      empty="No backtest runs yet. Use Run New Backtest to queue one."
      list={jobs.map((job) => {
        const status = backtestDisplayStatus(job);
        return (
          <JobCard
            key={job.id}
            selected={selectedJobId === job.id}
            onClick={() => onSelect(job.id)}
            status={status}
            title={job.symbolOrUniverse}
            subtitle={shortDate(job.requestedAt)}
            meta={job.timeframe}
            progress={job.progress}
            onCancel={isActiveJob(status) ? () => cancelMutation.mutate({ jobId: job.id }) : undefined}
          />
        );
      })}
      detail={<><CancelError error={cancelMutation.error} />{detail}</>}
    />
  );
}

// ============================================================
// Parameter sweeps
// ============================================================

function SweepsTab({ strategyId, selectedId, onSelect }: { strategyId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data, refetch } = trpc.strategyOptimisation.listSweeps.useQuery(
    { strategyId },
    { refetchInterval: (query: { state: { data?: { sweeps: SweepView[] } } }) => jobPollInterval((query.state.data?.sweeps ?? []).map((s) => s.status)) },
  );
  const sweeps = data?.sweeps ?? [];
  const selected = sweeps.find((s) => s.id === selectedId) ?? null;
  const { data: detailData } = trpc.strategyOptimisation.getSweep.useQuery(
    { sweepId: selectedId! },
    { enabled: selected?.status === "COMPLETED" },
  );
  const cancelMutation = trpc.strategyOptimisation.cancelSweep.useMutation({ onSuccess: () => refetch() });

  let detail: React.ReactNode;
  if (!selected) detail = <Placeholder>Select a sweep to view results</Placeholder>;
  else if (selected.status === "FAILED") {
    detail = (
      <FailureNotice
        title="Sweep failed"
        message="The sweep could not run. Check that the symbol has stored candles for the date range and that the strategy's latest version still has the swept parameters."
      />
    );
  } else if (selected.status === "CANCELLED") detail = <Placeholder icon={false}>This sweep was cancelled.</Placeholder>;
  else if (selected.status !== "COMPLETED") {
    detail = (
      <Placeholder>
        {selected.status === "QUEUED"
          ? "Queued: waiting for the job runner to pick it up."
          : `Running… ${selected.completedCount} of ${selected.combinationCount} combinations backtested`}
      </Placeholder>
    );
  } else if (!detailData) detail = <Placeholder icon={false}>Loading…</Placeholder>;
  else detail = <SweepDetail sweep={detailData.sweep} results={detailData.results} robustness={detailData.robustness} />;

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      empty="No parameter sweeps yet. Use New Parameter Sweep to queue one."
      list={sweeps.map((s) => (
        <JobCard
          key={s.id}
          selected={selectedId === s.id}
          onClick={() => onSelect(s.id)}
          status={s.status}
          title={`${s.symbolOrUniverse} · ${s.combinationCount} combos`}
          subtitle={shortDate(s.createdAt)}
          meta={s.timeframe}
          progress={sweepProgress(s)}
          // The API cancels sweeps that have not started yet.
          onCancel={s.status === "QUEUED" ? () => cancelMutation.mutate({ sweepId: s.id }) : undefined}
        />
      ))}
      detail={<><CancelError error={cancelMutation.error} />{detail}</>}
    />
  );
}

function SweepDetail({ sweep, results, robustness }: { sweep: SweepView; results: SweepResultView[]; robustness: SweepRobustness | null }) {
  if (results.length === 0) return <Placeholder icon={false}>The sweep finished without results.</Placeholder>;
  const ranked = [...results]
    .filter((r) => r.resultSummary)
    .sort((a, b) => Number(b.resultSummary!.sharpe) - Number(a.resultSummary!.sharpe))
    .slice(0, 20);
  const names = sweep.parameters.map((p) => p.name);

  return (
    <div className="space-y-5">
      {robustness && (
        <RobustnessHeatmapView analysis={robustness.analysis} paramXName={robustness.paramX} paramYName={robustness.paramY} />
      )}
      <div>
        <h3 className="text-sm font-medium mb-2">Top combinations by Sharpe ({ranked.length} of {results.length})</h3>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-panel border-b border-border">
              <tr>
                {[...names, "Sharpe", "Return", "Max DD", "Win rate", "Trades"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {ranked.map((r) => {
                const s = r.resultSummary!;
                return (
                  <tr key={r.id} className="hover:bg-panel/60">
                    {names.map((n) => <td key={n} className="px-3 py-2">{r.parameterValues[n]}</td>)}
                    <td className="px-3 py-2">{fmtNum(s.sharpe, 2)}</td>
                    <td className={`px-3 py-2 ${Number(s.totalReturn) >= 0 ? "text-bull" : "text-bear"}`}>{formatPercent(s.totalReturn)}</td>
                    <td className="px-3 py-2 text-bear">{formatPercent(s.maxDrawdown)}</td>
                    <td className="px-3 py-2">{formatPercent(s.winRate)}</td>
                    <td className="px-3 py-2">{s.tradeCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs text-muted-foreground border-t border-border pt-3">
        In-sample results only: the best combination of a sweep is optimistic. Use a walk-forward test to check it on unseen data.
      </div>
    </div>
  );
}

// ============================================================
// Walk-forward
// ============================================================

function WalkForwardTab({ strategyId, selectedId, onSelect }: { strategyId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data, refetch } = trpc.strategyOptimisation.listWalkForwards.useQuery(
    { strategyId },
    { refetchInterval: (query: { state: { data?: { runs: WalkForwardRunView[] } } }) => jobPollInterval((query.state.data?.runs ?? []).map((r) => r.status)) },
  );
  const runs = data?.runs ?? [];
  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const { data: detailData } = trpc.strategyOptimisation.getWalkForward.useQuery(
    { runId: selectedId! },
    { enabled: selected?.status === "COMPLETED" },
  );

  let detail: React.ReactNode;
  if (!selected) detail = <Placeholder>Select a walk-forward run to view results</Placeholder>;
  else if (selected.status === "FAILED") {
    detail = <FailureNotice title="Walk-forward run failed" message={walkForwardError(selected) ?? "No details were recorded."} />;
  } else if (selected.status !== "COMPLETED") {
    detail = (
      <Placeholder>
        {selected.status === "QUEUED" ? "Queued: waiting for the job runner to pick it up." : "Running… optimising and testing each window."}
      </Placeholder>
    );
  } else {
    const result = detailData ? walkForwardViewResult(detailData.run, detailData.windows) : null;
    detail = result ? (
      <div className="space-y-4">
        <WalkForwardView result={result} />
        {result.warnings.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-300">
            {result.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
          </ul>
        )}
      </div>
    ) : (
      <Placeholder icon={false}>Loading…</Placeholder>
    );
  }

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      empty="No walk-forward runs yet. Use New Walk-Forward Test to queue one."
      list={runs.map((r) => (
        <JobCard
          key={r.id}
          selected={selectedId === r.id}
          onClick={() => onSelect(r.id)}
          status={r.status}
          title={`${r.symbol} · ${r.mode.toLowerCase()}`}
          subtitle={shortDate(r.createdAt)}
          meta={r.timeframe}
        />
      ))}
      detail={detail}
    />
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
