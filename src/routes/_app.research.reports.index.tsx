import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyLine, ErrorLine, PageHeader, primaryButton, secondaryButton } from "@/components/strategy/page-chrome";
import { count, decimal, percent, shortDate, signTone } from "@/components/strategy/format";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { researchReports } from "@/components/research-reports/api";
import { MAX_COMPARE_RUNS, MIN_COMPARE_RUNS, toggleRun } from "@/components/research-reports/selection";

export const Route = createFileRoute("/_app/research/reports/")({
  head: () => ({ meta: [{ title: "Run reports — MAET Strategy Lab" }] }),
  component: RunReportsPage,
});

function RunReportsPage() {
  const signedIn = useSignedIn();
  const [selected, setSelected] = useState<string[]>([]);
  const { data, isLoading, error } = researchReports.listRuns.useQuery(undefined, { enabled: signedIn });
  const runs = data?.runs ?? [];
  const canCompare = selected.length >= MIN_COMPARE_RUNS;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Run reports"
        meta={`Completed strategy backtests: open a reproducible report, or pick ${MIN_COMPARE_RUNS}-${MAX_COMPARE_RUNS} runs to compare`}
        actions={
          signedIn && (
            <>
              <Link to="/strategies" className={secondaryButton}>Strategy Lab</Link>
              {canCompare ? (
                <Link to="/research/reports/compare" search={{ runs: selected.join(",") }} className={primaryButton}>
                  Compare {selected.length} runs
                </Link>
              ) : (
                <button type="button" disabled className={primaryButton}>Compare (select {MIN_COMPARE_RUNS}-{MAX_COMPARE_RUNS})</button>
              )}
            </>
          )
        }
      />
      <div className="space-y-3 p-4">
        {!signedIn ? (
          <SignedOutNotice feature="Run reports" />
        ) : error ? (
          <ErrorLine title="Could not load runs" error={error} />
        ) : isLoading ? (
          <EmptyLine>Loading runs…</EmptyLine>
        ) : runs.length === 0 ? (
          <EmptyLine>No completed backtests yet. Run one from a strategy's Research page.</EmptyLine>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full whitespace-nowrap text-xs">
              <caption className="sr-only">Completed backtest runs; select up to {MAX_COMPARE_RUNS} to compare</caption>
              <thead className="border-b border-border bg-panel text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Compare</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Strategy</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Symbol</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Window</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Return</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Max DD</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Sharpe</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Trades</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => {
                  const label = `${run.strategyName} v${run.versionNumber}, ${run.symbolOrUniverse} ${run.timeframe}`;
                  const checked = selected.includes(run.jobId);
                  return (
                    <tr key={run.jobId} className={checked ? "bg-accent/40" : undefined}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Compare ${label}`}
                          checked={checked}
                          disabled={!checked && selected.length >= MAX_COMPARE_RUNS}
                          onChange={() => setSelected((s) => toggleRun(s, run.jobId))}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Link to="/research/reports/$jobId" params={{ jobId: run.jobId }} className="text-primary hover:underline">
                          {run.strategyName} <span className="text-muted-foreground">v{run.versionNumber}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">{run.symbolOrUniverse} · {run.timeframe}</td>
                      <td className="px-3 py-1.5">{shortDate(run.fromDate)} – {shortDate(run.toDate)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${signTone(run.totalReturn)}`}>{percent(run.totalReturn)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{percent(run.maxDrawdown)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{decimal(run.sharpe)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{count(run.tradeCount)}</td>
                      <td className="px-3 py-1.5">{shortDate(run.completedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
