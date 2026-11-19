import { Link } from "@tanstack/react-router";
import { count, decimal, percent, signTone } from "@/components/strategy/format";
import { ComparisonChart, RunSwatch } from "./comparison-chart";
import type { RunComparison } from "./api";

const COST_DRAG_HINT = "Fees plus slippage of trades entered in the window, as a share of equity at the window start";
const TURNOVER_HINT = "Traded value of both legs over average equity in the window";

export function ComparisonView({ comparison }: { comparison: RunComparison }) {
  const { intersection, runs, flags } = comparison;
  const dates = runs[0]?.series.map((p) => p.date) ?? [];
  const hasCurves = intersection.status !== "NO_OVERLAP";

  return (
    <div className="space-y-4">
      <section aria-label="Common window" className="rounded border border-border bg-panel p-3 text-xs">
        <h2 className="font-medium text-muted-foreground">Common window</h2>
        <p className="mt-1">{intersection.statement}</p>
        <ul className="mt-2 space-y-0.5 text-muted-foreground">
          {runs.map((run, i) => (
            <li key={run.jobId} className="flex flex-wrap items-center gap-1.5">
              <RunSwatch index={i} />
              <span className="text-foreground">{run.label}</span>
              <span>
                — own dates {run.ownWindow.from ?? "—"} to {run.ownWindow.to ?? "—"} ({count(run.ownWindow.dates)}); {count(run.excludedDates)} outside the
                common window left out
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Like-for-like check"
        role={flags.length ? "status" : undefined}
        className={`rounded border px-3 py-2 text-xs ${flags.length ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-border bg-panel text-muted-foreground"}`}
      >
        {flags.length === 0 ? (
          <p>Like-for-like: same cost and fill assumptions, benchmark, timeframe and engine version.</p>
        ) : (
          <>
            <p className="font-medium">Not like-for-like</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {flags.map((f) => <li key={f.code}>{f.message}</li>)}
            </ul>
          </>
        )}
      </section>

      {hasCurves && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ComparisonChart
            title="Equity, rebased to 100"
            dates={dates}
            reference={100}
            format={(v) => decimal(v, 1)}
            runs={runs.map((r) => ({ label: r.label, values: r.series.map((p) => p.equity) }))}
          />
          <ComparisonChart
            title="Drawdown from peak"
            dates={dates}
            reference={0}
            format={(v) => percent(v, 1)}
            runs={runs.map((r) => ({ label: r.label, values: r.series.map((p) => p.drawdown) }))}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full whitespace-nowrap text-xs">
          <caption className="border-b border-border bg-panel px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
            Metrics over the common window{intersection.from ? ` (${intersection.from} to ${intersection.to})` : ""}
          </caption>
          <thead className="border-b border-border bg-panel text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">Run</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Return</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">CAGR</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Max DD</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Sharpe</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium"><abbr title={TURNOVER_HINT}>Turnover</abbr></th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium"><abbr title={COST_DRAG_HINT}>Cost drag</abbr></th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Trades</th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">Costs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono tabular-nums">
            {runs.map((run, i) => {
              const m = run.metrics;
              const c = run.costAssumptions;
              return (
                <tr key={run.jobId}>
                  <th scope="row" className="px-3 py-1.5 text-left font-sans font-normal">
                    <span className="flex items-center gap-1.5">
                      <RunSwatch index={i} />
                      <Link to="/research/reports/$jobId" params={{ jobId: run.jobId }} className="text-primary hover:underline">{run.label}</Link>
                    </span>
                  </th>
                  <td className={`px-3 py-1.5 text-right ${signTone(m.totalReturn)}`}>{percent(m.totalReturn)}</td>
                  <td className={`px-3 py-1.5 text-right ${signTone(m.cagr)}`}>{percent(m.cagr)}</td>
                  <td className="px-3 py-1.5 text-right">{percent(m.maxDrawdown)}</td>
                  <td className="px-3 py-1.5 text-right">{decimal(m.sharpe)}</td>
                  <td className="px-3 py-1.5 text-right">{m.turnover === null ? "—" : `${decimal(m.turnover)}×`}</td>
                  <td className="px-3 py-1.5 text-right">{percent(m.costDrag, 3)}</td>
                  <td className="px-3 py-1.5 text-right">{count(m.tradeCount)}</td>
                  <td className="px-3 py-1.5 text-left font-sans text-muted-foreground">
                    {c.feeModel}
                    {c.feeBps !== null ? ` ${c.feeBps} bps` : ""} · slip {c.slippageBps} bps · {c.fillPolicy}
                    {run.benchmarkSymbol ? ` · vs ${run.benchmarkSymbol}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        “—” marks a value that cannot be computed over this window (fewer than two common dates, or no variation for Sharpe). Sharpe uses a zero
        risk-free rate, annualised by the number of common dates per year.
      </p>
    </div>
  );
}
