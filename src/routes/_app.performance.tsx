import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, FlaskConical, ChevronRight, Layers } from "lucide-react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/_app/performance")({
  head: () => ({ meta: [{ title: "Performance — MAET Strategy Lab" }] }),
  component: PerformancePage,
});

function PerformancePage() {
  const { data: jobsData, isLoading } = trpc.strategyBacktests.listJobs.useQuery({ limit: 50 });
  const jobs = jobsData?.jobs ?? [];
  const completedJobs = jobs.filter((j: any) => j.status === "COMPLETED");

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const { data: compareData } = trpc.strategyBacktests.compareJobs.useQuery(
    { jobIds: compareIds },
    { enabled: compareIds.length >= 2 },
  );

  function toggleCompare(jobId: string) {
    setCompareIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : prev.length < 5 ? [...prev, jobId] : prev,
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">Performance Overview</h1>
        </div>
        {compareIds.length >= 2 && (
          <button
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Layers className="h-3.5 w-3.5" />
            Compare {compareIds.length} Runs
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg border border-border bg-panel animate-pulse" />
            ))}
          </div>
        ) : completedJobs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border">
            <BarChart3 className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-1">No completed backtests</p>
            <p className="text-xs text-muted-foreground mb-4">Run a backtest from the Strategy Lab to see results here</p>
            <Link
              to="/strategies"
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Go to Strategy Lab
            </Link>
          </div>
        ) : (
          <>
            {/* Compare selection helper */}
            {completedJobs.length >= 2 && (
              <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
                Select up to 5 runs with the checkbox to compare side-by-side
              </div>
            )}

            {/* Compare panel */}
            {compareIds.length >= 2 && compareData?.snapshots && (
              <div className="mb-5 rounded-lg border border-border bg-panel overflow-hidden">
                <div className="border-b border-border px-4 py-2.5 text-sm font-medium">Side-by-Side Comparison</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        {["Metric", ...compareData.snapshots.map((_: any, i: number) => `Run ${i + 1}`)].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[
                        { key: "totalReturn", label: "Total Return", pct: true },
                        { key: "annualizedReturn", label: "Ann. Return", pct: true },
                        { key: "maxDrawdown", label: "Max Drawdown", pct: true },
                        { key: "sharpe", label: "Sharpe", pct: false },
                        { key: "sortino", label: "Sortino", pct: false },
                        { key: "winRate", label: "Win Rate", pct: true },
                        { key: "profitFactor", label: "Profit Factor", pct: false },
                        { key: "tradeCount", label: "Trades", pct: false },
                      ].map((row) => (
                        <tr key={row.key} className="hover:bg-panel/60">
                          <td className="px-4 py-2 text-muted-foreground">{row.label}</td>
                          {compareData.snapshots.map((snap: any) => {
                            const val = snap[row.key];
                            const num = Number(val);
                            const formatted = row.pct
                              ? `${(num * 100).toFixed(2)}%`
                              : num.toFixed(2);
                            return (
                              <td key={snap.id} className={`px-4 py-2 font-mono ${num >= 0 ? "text-bull" : "text-bear"}`}>
                                {formatted}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* All runs */}
            <div className="space-y-2">
              {completedJobs.map((job: any) => (
                <PerformanceCard
                  key={job.id}
                  job={job}
                  selected={compareIds.includes(job.id)}
                  onToggleCompare={() => toggleCompare(job.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PerformanceCard({ job, selected, onToggleCompare }: {
  job: any; selected: boolean; onToggleCompare: () => void;
}) {
  const { data: perfData } = trpc.strategyBacktests.getPerformance.useQuery({ jobId: job.id });
  const snap = perfData?.snapshot;

  const totalReturn = snap ? Number(snap.totalReturn) * 100 : null;
  const maxDrawdown = snap ? Number(snap.maxDrawdown) * 100 : null;
  const isPositive = totalReturn != null && totalReturn >= 0;

  return (
    <div className={`rounded-lg border bg-panel p-4 transition-colors ${selected ? "border-primary" : "border-border"}`}>
      <div className="flex items-start gap-4">
        {/* Compare checkbox */}
        <button
          onClick={onToggleCompare}
          className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            selected ? "border-primary bg-primary" : "border-border"
          }`}
        >
          {selected && <div className="h-2 w-2 rounded-sm bg-primary-foreground" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-sm font-medium truncate">{job.symbolOrUniverse}</span>
            <span className="text-xs text-muted-foreground font-mono">{job.timeframe}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(job.requestedAt).toLocaleDateString()}
            </span>
          </div>

          {snap ? (
            <div className="grid grid-cols-4 gap-3">
              <MetricCell label="Return" value={`${totalReturn?.toFixed(2)}%`} positive={isPositive} />
              <MetricCell label="Max DD" value={`${maxDrawdown?.toFixed(2)}%`} positive={false} negative />
              <MetricCell label="Sharpe" value={Number(snap.sharpe).toFixed(2)} />
              <MetricCell label="Trades" value={String(snap.tradeCount ?? 0)} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Loading metrics...</div>
          )}
        </div>

        <Link
          to="/strategies/$strategyId/backtests"
          params={{ strategyId: "current" }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function MetricCell({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-medium ${
        positive === true ? "text-bull" : negative ? "text-bear" : "text-foreground"
      }`}>
        {value}
      </div>
    </div>
  );
}
