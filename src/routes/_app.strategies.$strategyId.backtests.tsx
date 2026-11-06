import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import type { SweepRobustness } from "../../server/modules/strategy-optimisation/sweep-robustness";
import { RunJobDialog } from "@/components/strategy/run-job-dialog";
import { RobustnessHeatmapView } from "@/components/strategy/robustness-heatmap-view";
import { WalkForwardView } from "@/components/strategy/walk-forward-view";
import { EquityLine } from "@/components/strategy/equity-line";
import { EmptyLine, ErrorLine, MetricGrid, PageHeader, primaryButton, ViewSwitch, type MetricItem } from "@/components/strategy/page-chrome";
import { count, dateTime, decimal, percent, percentValue, rupees, shortDate, signTone, toNumber } from "@/components/strategy/format";
import type { BacktestTradeRow, EquityPointRow, PerformanceSnapshotRow } from "@/components/strategy/backtest-rows";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
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
  { id: "backtests", label: "Backtests", newLabel: "New backtest" },
  { id: "sweeps", label: "Sweeps", newLabel: "New sweep" },
  { id: "walk-forward", label: "Walk-forward", newLabel: "New walk-forward" },
];

function StrategyBacktestsPage() {
  const { strategyId } = Route.useParams();
  const signedIn = useSignedIn();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? "backtests";
  const selectedId = search.job ?? null;
  const [dialogKind, setDialogKind] = useState<JobKind | null>(null);

  const { data: stratData, error: strategyError } = trpc.strategyDefinitions.get.useQuery({ strategyId }, { enabled: signedIn });
  const versions: Array<{ id: string; versionNumber: number; definition: unknown }> = stratData?.versions ?? [];
  const strategyName: string | undefined = stratData?.strategy?.name;

  const select = (nextTab: ResearchTab, job?: string) =>
    navigate({ search: { tab: nextTab === "backtests" ? undefined : nextTab, job }, replace: true });

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col overflow-y-auto md:overflow-hidden">
      <PageHeader
        title="Research"
        meta={
          <>
            <Link to="/strategies/$strategyId" params={{ strategyId }} className="hover:text-foreground">{strategyName ?? "Strategy"}</Link>
            {versions[0] ? ` · jobs run v${versions[0].versionNumber}` : stratData ? " · no saved version yet" : ""}
          </>
        }
        actions={
          signedIn && (
            <>
              <ViewSwitch label="Research view" options={TABS} value={tab} onChange={(id) => select(id)} />
              <button type="button" onClick={() => setDialogKind(JOB_KIND_FOR_TAB[tab])} className={primaryButton}>
                {activeTab.newLabel}
              </button>
            </>
          )
        }
      />

      {!signedIn ? (
        <div className="p-4"><SignedOutNotice feature="Backtests and research jobs" /></div>
      ) : (
        <>
          {strategyError && <div className="px-4 pt-3"><ErrorLine title="Could not load the strategy" error={strategyError} /></div>}
          {tab === "backtests" && (
            <BacktestsTab versionIds={versions.map((v) => v.id)} selectedJobId={selectedId} onSelect={(id) => select("backtests", id)} />
          )}
          {tab === "sweeps" && <SweepsTab strategyId={strategyId} selectedId={selectedId} onSelect={(id) => select("sweeps", id)} />}
          {tab === "walk-forward" && (
            <WalkForwardTab strategyId={strategyId} selectedId={selectedId} onSelect={(id) => select("walk-forward", id)} />
          )}
        </>
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

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  QUEUED: { text: "Queued", tone: "text-muted-foreground" },
  RUNNING: { text: "Running", tone: "text-primary" },
  CANCELLING: { text: "Cancelling", tone: "text-muted-foreground" },
  COMPLETED: { text: "Done", tone: "text-bull" },
  FAILED: { text: "Failed", tone: "text-bear" },
  CANCELLED: { text: "Cancelled", tone: "text-muted-foreground/60" },
};

function JobListLayout({ list, detail, empty, error, onRefresh }: {
  list: ReactNode[];
  detail: ReactNode;
  empty: string;
  error: Error | null;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
      <div className="shrink-0 border-b border-border md:w-72 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{list.length} run{list.length === 1 ? "" : "s"}</span>
          <button type="button" onClick={onRefresh} className="hover:text-foreground">Refresh</button>
        </div>
        {error ? (
          <div className="p-3"><ErrorLine title="Could not load runs" error={error} /></div>
        ) : list.length === 0 ? (
          <EmptyLine>{empty}</EmptyLine>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto md:max-h-none">{list}</ul>
        )}
      </div>
      <div className="min-w-0 p-4 md:flex-1 md:overflow-y-auto">{detail}</div>
    </div>
  );
}

function JobRow({ selected, onClick, status, title, when, meta, progress, onCancel }: {
  selected: boolean;
  onClick: () => void;
  status: string;
  title: string;
  when: string;
  meta: string;
  progress?: number;
  onCancel?: () => void;
}) {
  const label = STATUS_LABEL[status] ?? { text: status.toLowerCase(), tone: "text-muted-foreground" };
  return (
    <li className={selected ? "bg-accent" : "hover:bg-accent/40"}>
      <button type="button" onClick={onClick} aria-current={selected} className="w-full px-3 py-2 text-left">
        <span className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium">{title}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">{when}</span>
          <span className={label.tone}>
            {label.text}
            {status === "RUNNING" && progress !== undefined ? ` ${progress}%` : ""}
          </span>
        </span>
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="px-3 pb-2 text-[11px] text-muted-foreground hover:text-bear">
          Cancel
        </button>
      )}
    </li>
  );
}

function StatusNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function CancelError({ error }: { error: Error | null }) {
  if (!error) return null;
  const info = describeJobError(error);
  return <div className="mb-3"><ErrorLine title={info.title} error={info.message} /></div>;
}

// ============================================================
// Backtests
// ============================================================

function BacktestsTab({ versionIds, selectedJobId, onSelect }: {
  versionIds: string[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: jobsData, error, refetch } = trpc.strategyBacktests.listJobs.useQuery(
    { limit: 50 },
    { refetchInterval: (query: { state: { data?: { jobs: BacktestJobView[] } } }) => jobPollInterval((query.state.data?.jobs ?? []).map((j) => j.status)) },
  );
  // listJobs covers every strategy of the user; keep this strategy's versions.
  const jobs = (jobsData?.jobs ?? []).filter((j) => versionIds.includes(j.strategyVersionId));
  const selected = jobs.find((j) => j.id === selectedJobId) ?? null;
  const completed = selected?.status === "COMPLETED";

  const { data: perfData, error: perfError } = trpc.strategyBacktests.getPerformance.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const { data: tradesData } = trpc.strategyBacktests.getTrades.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const { data: equityData } = trpc.strategyBacktests.getEquityCurve.useQuery({ jobId: selectedJobId! }, { enabled: completed });
  const cancelMutation = trpc.strategyBacktests.cancelJob.useMutation({ onSuccess: () => refetch() });

  let detail: ReactNode;
  if (!selected) {
    detail = <StatusNote>Select a run to see its metrics, equity curve and trades.</StatusNote>;
  } else if (selected.status === "FAILED") {
    detail = <ErrorLine title={`Backtest failed (${selected.errorCode ?? "error"})`} error={selected.errorSummary ?? "No details were recorded."} />;
  } else if (selected.status === "CANCELLED") {
    detail = <StatusNote>This backtest was cancelled.</StatusNote>;
  } else if (!completed) {
    detail = <StatusNote>{selected.status === "QUEUED" ? "Queued: waiting for the job runner to pick it up." : `Running… ${selected.progress}%`}</StatusNote>;
  } else if (perfError) {
    detail = <ErrorLine title="Could not load results" error={perfError} />;
  } else if (perfData?.snapshot) {
    detail = <BacktestDetail job={selected} snapshot={perfData.snapshot} trades={tradesData?.trades ?? []} equityPoints={equityData?.points ?? []} />;
  } else {
    detail = <StatusNote>{perfData ? "No stored results for this run." : "Loading…"}</StatusNote>;
  }

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      error={error}
      empty="No backtests for this strategy yet."
      list={jobs.map((job) => {
        const status = backtestDisplayStatus(job);
        return (
          <JobRow
            key={job.id}
            selected={selectedJobId === job.id}
            onClick={() => onSelect(job.id)}
            status={status}
            title={job.symbolOrUniverse}
            when={shortDate(job.requestedAt)}
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

function BacktestDetail({ job, snapshot, trades, equityPoints }: {
  job: BacktestJobView;
  snapshot: PerformanceSnapshotRow;
  trades: BacktestTradeRow[];
  equityPoints: EquityPointRow[];
}) {
  const profitFactor = toNumber(snapshot.profitFactor);
  const metrics: MetricItem[] = [
    { label: "Total return", value: percent(snapshot.totalReturn), tone: signTone(snapshot.totalReturn) },
    { label: "Annualised return", value: percent(snapshot.annualizedReturn), tone: signTone(snapshot.annualizedReturn) },
    { label: "Max drawdown", value: percent(snapshot.maxDrawdown), tone: toNumber(snapshot.maxDrawdown) ? "text-bear" : "" },
    { label: "Net profit", value: rupees(snapshot.netProfit, 0), tone: signTone(snapshot.netProfit) },
    { label: "Sharpe", value: decimal(snapshot.sharpe) },
    { label: "Sortino", value: decimal(snapshot.sortino) },
    { label: "Calmar", value: decimal(snapshot.calmar) },
    { label: "Win rate", value: percent(snapshot.winRate, 1) },
    {
      label: "Profit factor",
      value: profitFactor === null ? "—" : profitFactor.toFixed(2),
      hint: profitFactor === null ? "Undefined: no losing trades" : undefined,
    },
    { label: "Expectancy per trade", value: rupees(snapshot.expectancy), tone: signTone(snapshot.expectancy) },
    { label: "Trades (long / short)", value: `${count(snapshot.tradeCount)} (${count(snapshot.longTradeCount)} / ${count(snapshot.shortTradeCount)})` },
    { label: "Fees + slippage", value: `${rupees(snapshot.feesPaid, 0)} + ${rupees(snapshot.slippageCost, 0)}` },
  ];

  return (
    <div className="space-y-4">
      <p className="font-mono text-[11px] text-muted-foreground">
        {job.symbolOrUniverse} · {job.timeframe} · {shortDate(job.fromDate)} – {shortDate(job.toDate)} · engine v{snapshot.engineVersion} ·{" "}
        {snapshot.executionPolicy} · {snapshot.intrabarPolicy}
        {snapshot.dataHash ? <span title={snapshot.dataHash}> · data {String(snapshot.dataHash).slice(0, 10)}</span> : null}
      </p>

      <MetricGrid label="Backtest metrics" items={metrics} />

      <section className="rounded border border-border bg-panel p-3">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Equity</h3>
        <EquityLine
          label="Backtest equity curve"
          height={200}
          points={equityPoints.map((p) => ({ time: p.timestamp, equity: Number(p.equity) }))}
        />
      </section>

      <TradesTable trades={trades} />
    </div>
  );
}

const TRADE_LIMIT = 100;

function TradesTable({ trades }: { trades: BacktestTradeRow[] }) {
  if (trades.length === 0) return <p className="text-xs text-muted-foreground">The run closed no trades.</p>;
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
        Trades {trades.length > TRADE_LIMIT ? `(first ${TRADE_LIMIT} of ${count(trades.length)})` : `(${trades.length})`}
      </h3>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Side</th>
              <th className="px-3 py-1.5 text-left font-medium">Entry (IST)</th>
              <th className="px-3 py-1.5 text-right font-medium">Entry ₹</th>
              <th className="px-3 py-1.5 text-left font-medium">Exit (IST)</th>
              <th className="px-3 py-1.5 text-right font-medium">Exit ₹</th>
              <th className="px-3 py-1.5 text-right font-medium">Qty</th>
              <th className="px-3 py-1.5 text-right font-medium">Net P&amp;L ₹</th>
              <th className="px-3 py-1.5 text-right font-medium">Return</th>
              <th className="px-3 py-1.5 text-right font-medium">Bars</th>
              <th className="px-3 py-1.5 text-left font-medium">Exit reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {trades.slice(0, TRADE_LIMIT).map((t) => (
              <tr key={t.id} className="hover:bg-accent/30">
                <td className={`px-3 py-1.5 font-sans ${t.direction === "LONG" ? "text-bull" : "text-bear"}`}>{t.direction === "LONG" ? "Long" : "Short"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{dateTime(t.entryFillTimestamp)}</td>
                <td className="px-3 py-1.5 text-right">{rupees(t.entryPrice).replace("₹", "")}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{dateTime(t.exitFillTimestamp)}</td>
                <td className="px-3 py-1.5 text-right">{rupees(t.exitPrice).replace("₹", "")}</td>
                <td className="px-3 py-1.5 text-right">{count(t.entryQuantity)}</td>
                <td className={`px-3 py-1.5 text-right ${signTone(t.netPnl)}`}>{rupees(t.netPnl).replace("₹", "")}</td>
                <td className={`px-3 py-1.5 text-right ${signTone(t.returnPercent)}`}>{percentValue(t.returnPercent)}</td>
                <td className="px-3 py-1.5 text-right">{t.holdingBars ?? "—"}</td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 font-sans text-muted-foreground" title={t.exitReason ?? undefined}>{t.exitReason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================
// Parameter sweeps
// ============================================================

function SweepsTab({ strategyId, selectedId, onSelect }: { strategyId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data, error, refetch } = trpc.strategyOptimisation.listSweeps.useQuery(
    { strategyId },
    { refetchInterval: (query: { state: { data?: { sweeps: SweepView[] } } }) => jobPollInterval((query.state.data?.sweeps ?? []).map((s) => s.status)) },
  );
  const sweeps = data?.sweeps ?? [];
  const selected = sweeps.find((s) => s.id === selectedId) ?? null;
  const { data: detailData, error: detailError } = trpc.strategyOptimisation.getSweep.useQuery(
    { sweepId: selectedId! },
    { enabled: selected?.status === "COMPLETED" },
  );
  const cancelMutation = trpc.strategyOptimisation.cancelSweep.useMutation({ onSuccess: () => refetch() });

  let detail: ReactNode;
  if (!selected) detail = <StatusNote>Select a sweep to see how each parameter combination performed.</StatusNote>;
  else if (selected.status === "FAILED") {
    detail = (
      <ErrorLine
        title="Sweep failed"
        error="Check that the symbol has stored candles for the date range and that the latest version still has the swept parameters."
      />
    );
  } else if (selected.status === "CANCELLED") detail = <StatusNote>This sweep was cancelled.</StatusNote>;
  else if (selected.status !== "COMPLETED") {
    detail = (
      <StatusNote>
        {selected.status === "QUEUED"
          ? "Queued: waiting for the job runner to pick it up."
          : `Running… ${selected.completedCount} of ${selected.combinationCount} combinations backtested`}
      </StatusNote>
    );
  } else if (detailError) detail = <ErrorLine title="Could not load sweep results" error={detailError} />;
  else if (!detailData) detail = <StatusNote>Loading…</StatusNote>;
  else detail = <SweepDetail sweep={detailData.sweep} results={detailData.results} robustness={detailData.robustness} />;

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      error={error}
      empty="No parameter sweeps for this strategy yet."
      list={sweeps.map((s) => (
        <JobRow
          key={s.id}
          selected={selectedId === s.id}
          onClick={() => onSelect(s.id)}
          status={s.status}
          title={`${s.symbolOrUniverse} · ${s.combinationCount} combinations`}
          when={shortDate(s.createdAt)}
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
  if (results.length === 0) return <StatusNote>The sweep finished without results.</StatusNote>;
  const ranked = [...results]
    .filter((r) => r.resultSummary)
    .sort((a, b) => Number(b.resultSummary!.sharpe) - Number(a.resultSummary!.sharpe))
    .slice(0, 20);
  const names = sweep.parameters.map((p) => p.name);

  return (
    <div className="space-y-4">
      {robustness && (
        <RobustnessHeatmapView analysis={robustness.analysis} paramXName={robustness.paramX} paramYName={robustness.paramY} />
      )}
      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          Top {ranked.length} of {results.length} combinations by Sharpe · in-sample, so the best row is optimistic; confirm it with a walk-forward test
        </h3>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full whitespace-nowrap text-xs">
            <thead className="border-b border-border bg-panel text-muted-foreground">
              <tr>
                {names.map((n) => <th key={n} className="px-3 py-1.5 text-left font-medium">{n}</th>)}
                <th className="px-3 py-1.5 text-right font-medium">Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">Return</th>
                <th className="px-3 py-1.5 text-right font-medium">Max DD</th>
                <th className="px-3 py-1.5 text-right font-medium">Win rate</th>
                <th className="px-3 py-1.5 text-right font-medium">Trades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {ranked.map((r) => {
                const s = r.resultSummary!;
                return (
                  <tr key={r.id} className="hover:bg-accent/30">
                    {names.map((n) => <td key={n} className="px-3 py-1.5">{r.parameterValues[n]}</td>)}
                    <td className="px-3 py-1.5 text-right">{decimal(s.sharpe)}</td>
                    <td className={`px-3 py-1.5 text-right ${signTone(s.totalReturn)}`}>{percent(s.totalReturn)}</td>
                    <td className="px-3 py-1.5 text-right text-bear">{percent(s.maxDrawdown)}</td>
                    <td className="px-3 py-1.5 text-right">{percent(s.winRate, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{count(s.tradeCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Walk-forward
// ============================================================

function WalkForwardTab({ strategyId, selectedId, onSelect }: { strategyId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data, error, refetch } = trpc.strategyOptimisation.listWalkForwards.useQuery(
    { strategyId },
    { refetchInterval: (query: { state: { data?: { runs: WalkForwardRunView[] } } }) => jobPollInterval((query.state.data?.runs ?? []).map((r) => r.status)) },
  );
  const runs = data?.runs ?? [];
  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const { data: detailData, error: detailError } = trpc.strategyOptimisation.getWalkForward.useQuery(
    { runId: selectedId! },
    { enabled: selected?.status === "COMPLETED" },
  );

  let detail: ReactNode;
  if (!selected) detail = <StatusNote>Select a walk-forward run to see its out-of-sample results.</StatusNote>;
  else if (selected.status === "FAILED") {
    detail = <ErrorLine title="Walk-forward run failed" error={walkForwardError(selected) ?? "No details were recorded."} />;
  } else if (selected.status !== "COMPLETED") {
    detail = (
      <StatusNote>
        {selected.status === "QUEUED" ? "Queued: waiting for the job runner to pick it up." : "Running… optimising and testing each window."}
      </StatusNote>
    );
  } else if (detailError) {
    detail = <ErrorLine title="Could not load walk-forward results" error={detailError} />;
  } else {
    const result = detailData ? walkForwardViewResult(detailData.run, detailData.windows) : null;
    detail = result ? (
      <div className="space-y-3">
        {result.warnings.length > 0 && (
          <ul className="space-y-1 rounded border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
            {result.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <WalkForwardView result={result} />
      </div>
    ) : (
      <StatusNote>Loading…</StatusNote>
    );
  }

  return (
    <JobListLayout
      onRefresh={() => refetch()}
      error={error}
      empty="No walk-forward runs for this strategy yet."
      list={runs.map((r) => (
        <JobRow
          key={r.id}
          selected={selectedId === r.id}
          onClick={() => onSelect(r.id)}
          status={r.status}
          title={`${r.symbol} · ${r.mode.toLowerCase()}`}
          when={shortDate(r.createdAt)}
          meta={r.timeframe}
        />
      ))}
      detail={detail}
    />
  );
}
