import type { WalkForwardAnalysisResult } from "../../../server/domain/strategy/walk-forward";
import { EquityLine } from "./equity-line";
import { decimal, percent, signTone } from "./format";
import { MetricGrid } from "./page-chrome";

interface Props {
  result: WalkForwardAnalysisResult;
}

const range = (dates: { from: string; to: string }) => `${dates.from.slice(0, 10)} → ${dates.to.slice(0, 10)}`;

export function WalkForwardView({ result }: Props) {
  const { summary, methodology, benchmark } = result;
  const trials = methodology?.selection.trialsPerWindow;

  return (
    <div className="space-y-4">
      {methodology && (
        <p className="text-xs text-muted-foreground">
          Each window: <span className="text-foreground">training</span> {methodology.trainingDays} days (in sample: the best
          training Sharpe of {trials} parameter set{trials === 1 ? "" : "s"} is selected retrospectively, so training figures
          are optimistic) → <span className="text-foreground">validation</span> {methodology.validationDays} days (out-of-sample
          holdout that only rejects, below Sharpe {methodology.validation.sharpeFloor}) →{" "}
          <span className="text-foreground">test</span> {methodology.testDays} days (out of sample). Windows step{" "}
          {methodology.stepDays} calendar days; a rejected window holds cash for its test segment.
        </p>
      )}

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          Out-of-sample: test segments joined, rejected windows held in cash and counted
        </h3>
        <MetricGrid
          label="Walk-forward summary"
          items={[
            { label: "OOS return", value: percent(summary.oosReturnTotal), tone: signTone(summary.oosReturnTotal) },
            { label: "OOS CAGR", value: percent(summary.oosAnnualisedReturn), tone: signTone(summary.oosAnnualisedReturn) },
            { label: "OOS Sharpe", value: decimal(summary.oosSharpe), tone: signTone(summary.oosSharpe) },
            { label: "OOS max drawdown", value: percent(summary.oosDrawdownMax), tone: summary.oosDrawdownMax ? "text-bear" : "" },
            {
              label: "Buy & hold, same dates and costs",
              value: benchmark ? percent(benchmark.totalReturn) : "—",
              tone: signTone(benchmark?.totalReturn),
            },
            { label: "OOS Sharpe (window mean)", value: decimal(summary.oosSharpeAvg), tone: signTone(summary.oosSharpeAvg) },
            { label: "Retention vs in-sample", value: summary.performanceRetention == null ? "—" : percent(summary.performanceRetention, 1) },
            { label: "Walk-forward efficiency", value: decimal(summary.walkForwardEfficiency) },
            { label: "Windows traded / in cash", value: `${summary.testedWindowsCount} / ${summary.cashWindowsCount} of ${summary.totalWindowsCount}` },
          ]}
        />
        {!benchmark && result.benchmarkReason && (
          <p className="mt-1 text-xs text-muted-foreground">No buy-and-hold benchmark: {result.benchmarkReason}</p>
        )}
      </section>

      <section className="rounded border border-border bg-panel p-3">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Out-of-sample equity, test segments joined (cash segments flat)</h3>
        <EquityLine
          label="Out-of-sample equity curve"
          height={200}
          points={(result.aggregateOosEquityCurve ?? []).map((p) => ({ time: p.timestamp, equity: p.equity }))}
        />
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Windows (training → validation → test)</h3>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="border-b border-border bg-panel text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Training (IS)</th>
                <th className="px-3 py-1.5 font-medium">Validation</th>
                <th className="px-3 py-1.5 font-medium">Test (OOS)</th>
                <th className="px-3 py-1.5 font-medium">Selected in sample</th>
                <th className="px-3 py-1.5 text-right font-medium">Training Sharpe (IS)</th>
                <th className="px-3 py-1.5 text-right font-medium">Validation Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS return</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS max DD</th>
                <th className="px-3 py-1.5 font-medium">Validation</th>
                <th className="px-3 py-1.5 font-medium">OOS held</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {result.windows.map((w) => (
                <tr key={w.windowNumber} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5">{w.windowNumber}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{range(w.trainDates)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{range(w.valDates)}</td>
                  <td className="px-3 py-1.5">{range(w.testDates)}</td>
                  <td className="px-3 py-1.5">
                    {w.selectedParameters
                      ? Object.entries(w.selectedParameters).map(([name, value]) => `${name} ${value}`).join(", ")
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">{w.isMetrics ? w.isMetrics.sharpe.toFixed(2) : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{w.valMetrics ? w.valMetrics.sharpe.toFixed(2) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right ${signTone(w.oosMetrics.sharpe)}`}>{w.oosMetrics.sharpe.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 text-right ${signTone(w.oosMetrics.totalReturn)}`}>{percent(w.oosMetrics.totalReturn, 1)}</td>
                  <td className="px-3 py-1.5 text-right text-bear">{percent(w.oosMetrics.maxDrawdown, 1)}</td>
                  <td className={`px-3 py-1.5 font-sans ${w.validationAccepted ? "text-bull" : "text-bear"}`} title={w.rejectionReason ?? undefined}>
                    {w.validationAccepted ? "Accepted" : "Rejected"}
                  </td>
                  <td className="px-3 py-1.5 font-sans" title={w.cashReason ?? undefined}>
                    {w.oosPosition === "CASH" ? "Cash" : "Strategy"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
