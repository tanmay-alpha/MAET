import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useSignedIn } from "@/hooks/use-signed-in";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { usePortfolioPerformance } from "@/hooks/use-portfolio-analytics";
import { curveToHistory } from "@/lib/portfolio-curve";
import { EquityCurveChart } from "@/components/chart/equity-curve-chart";
import { PortfolioPerformancePanel } from "@/components/trading/portfolio-performance-panel";
import { EmptyLine, ErrorLine, PageHeader, secondaryButton } from "@/components/strategy/page-chrome";
import { count, decimal, percent, shortDate, signTone } from "@/components/strategy/format";
import type { PerformanceSnapshotRow } from "@/components/strategy/backtest-rows";
import type { BacktestJobView } from "@/lib/strategy-jobs";

export const Route = createFileRoute("/_app/performance")({
  head: () => ({ meta: [{ title: "Performance — MAET Strategy Lab" }] }),
  component: PerformancePage,
});

const MAX_COMPARE = 5;

function PerformancePage() {
  const signedIn = useSignedIn();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Performance"
        meta="Paper account equity and completed strategy backtests"
        actions={<Link to="/strategies" className={secondaryButton}>Strategy Lab</Link>}
      />
      <div className="space-y-4 p-4">
        {signedIn ? (
          <>
            <PaperPortfolioSection />
            <BacktestRuns />
          </>
        ) : (
          <SignedOutNotice feature="Backtest results" />
        )}
      </div>
    </div>
  );
}

/** The paper account's server-side equity curve and metrics, next to the backtest runs. */
function PaperPortfolioSection() {
  const { query, signedIn } = usePortfolioPerformance();
  const { data, isLoading, error } = query;
  const history = useMemo(() => curveToHistory(data), [data]);
  return (
    <section className="rounded border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground">Paper portfolio</h2>
        <Link to="/portfolio" className="text-xs text-primary">Portfolio</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          {history.length > 0 ? (
            <EquityCurveChart data={history} height={180} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {isLoading ? "Loading equity curve…" : error ? "Equity curve unavailable" : "No daily snapshots of the paper account yet"}
            </p>
          )}
        </div>
        <PortfolioPerformancePanel performance={data} isLoading={isLoading} error={error?.message ?? null} signedIn={signedIn} />
      </div>
    </section>
  );
}

function BacktestRuns() {
  const { data: jobsData, isLoading, error } = trpc.strategyBacktests.listJobs.useQuery({ limit: 50 });
  const completedJobs = (jobsData?.jobs ?? []).filter((j) => j.status === "COMPLETED");

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const { data: compareData, error: compareError } = trpc.strategyBacktests.compareJobs.useQuery(
    { jobIds: compareIds },
    { enabled: compareIds.length >= 2 },
  );

  function toggleCompare(jobId: string) {
    setCompareIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : prev.length < MAX_COMPARE ? [...prev, jobId] : prev,
    );
  }

  let body: ReactNode;
  if (error) body = <div className="p-3"><ErrorLine title="Could not load backtests" error={error} /></div>;
  else if (isLoading) body = <EmptyLine>Loading backtests…</EmptyLine>;
  else if (completedJobs.length === 0) {
    body = <EmptyLine>No completed backtests. Run one from a saved strategy in the Strategy Lab.</EmptyLine>;
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-1.5"><span className="sr-only">Compare</span></th>
              <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
              <th className="hidden px-3 py-1.5 text-left font-medium sm:table-cell">Window</th>
              <th className="px-3 py-1.5 text-right font-medium">Return</th>
              <th className="px-3 py-1.5 text-right font-medium">Max DD</th>
              <th className="px-3 py-1.5 text-right font-medium">Sharpe</th>
              <th className="px-3 py-1.5 text-right font-medium">Trades</th>
              <th className="hidden px-3 py-1.5 text-right font-medium md:table-cell">Run on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {completedJobs.map((job) => (
              <RunRow
                key={job.id}
                job={job}
                selected={compareIds.includes(job.id)}
                disabled={!compareIds.includes(job.id) && compareIds.length >= MAX_COMPARE}
                onToggle={() => toggleCompare(job.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {compareIds.length >= 2 && (
        compareError ? <ErrorLine title="Could not compare runs" error={compareError} />
          : compareData?.snapshots ? <Comparison snapshots={compareData.snapshots} /> : null
      )}
      <section className="rounded border border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-xs font-medium text-muted-foreground">Completed backtests</h2>
          {completedJobs.length >= 2 && (
            <span className="text-[11px] text-muted-foreground">
              {compareIds.length === 0 ? `Tick 2–${MAX_COMPARE} runs to compare them` : `${compareIds.length} selected`}
            </span>
          )}
        </div>
        {body}
      </section>
    </>
  );
}

function RunRow({ job, selected, disabled, onToggle }: {
  job: BacktestJobView;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { data, error } = trpc.strategyBacktests.getPerformance.useQuery({ jobId: job.id });
  const snap: PerformanceSnapshotRow | null | undefined = data?.snapshot;
  const missing = error ? "error" : snap === null ? "—" : "…";

  return (
    <tr className={selected ? "bg-accent/50" : "hover:bg-accent/30"}>
      <td className="px-3 py-1.5">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Compare ${job.symbolOrUniverse} ${job.timeframe} run from ${shortDate(job.requestedAt)}`}
        />
      </td>
      <td className="px-3 py-1.5 font-mono font-medium">
        {job.symbolOrUniverse} <span className="font-normal text-muted-foreground">{job.timeframe}</span>
      </td>
      <td className="hidden px-3 py-1.5 font-mono text-muted-foreground sm:table-cell">{shortDate(job.fromDate)} – {shortDate(job.toDate)}</td>
      {snap ? (
        <>
          <td className={`px-3 py-1.5 text-right font-mono ${signTone(snap.totalReturn)}`}>{percent(snap.totalReturn)}</td>
          <td className="px-3 py-1.5 text-right font-mono text-bear">{percent(snap.maxDrawdown)}</td>
          <td className="px-3 py-1.5 text-right font-mono">{decimal(snap.sharpe)}</td>
          <td className="px-3 py-1.5 text-right font-mono">{count(snap.tradeCount)}</td>
        </>
      ) : (
        <td colSpan={4} className={`px-3 py-1.5 text-right ${error ? "text-bear" : "text-muted-foreground"}`} title={error?.message}>
          {missing}
        </td>
      )}
      <td className="hidden px-3 py-1.5 text-right font-mono text-muted-foreground md:table-cell">{shortDate(job.requestedAt)}</td>
    </tr>
  );
}

const COMPARE_ROWS: Array<{ key: keyof PerformanceSnapshotRow; label: string; format: (v: unknown) => string; signed?: boolean }> = [
  { key: "totalReturn", label: "Total return", format: (v) => percent(v), signed: true },
  { key: "annualizedReturn", label: "Annualised return", format: (v) => percent(v), signed: true },
  { key: "maxDrawdown", label: "Max drawdown", format: (v) => percent(v) },
  { key: "sharpe", label: "Sharpe", format: (v) => decimal(v) },
  { key: "sortino", label: "Sortino", format: (v) => decimal(v) },
  { key: "winRate", label: "Win rate", format: (v) => percent(v, 1) },
  { key: "profitFactor", label: "Profit factor", format: (v) => decimal(v) },
  { key: "tradeCount", label: "Trades", format: (v) => count(v) },
];

function Comparison({ snapshots }: { snapshots: PerformanceSnapshotRow[] }) {
  return (
    <section className="rounded border border-border">
      <h2 className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Side by side</h2>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Metric</th>
              {snapshots.map((s) => (
                <th key={s.id} className="px-3 py-1.5 text-right font-medium">
                  <span className="font-mono text-foreground">{s.symbolOrUniverse}</span> {s.timeframe}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {COMPARE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                {snapshots.map((s) => (
                  <td key={s.id} className={`px-3 py-1.5 text-right font-mono ${row.signed ? signTone(s[row.key]) : ""}`}>
                    {row.format(s[row.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
