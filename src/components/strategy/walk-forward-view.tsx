import type { WalkForwardAnalysisResult } from "../../../server/domain/strategy/walk-forward";
import { EquityLine } from "./equity-line";
import { percent, signTone } from "./format";
import { MetricGrid } from "./page-chrome";

interface Props {
  result: WalkForwardAnalysisResult;
}

const range = (dates: { from: string; to: string }) => `${dates.from.slice(0, 10)} → ${dates.to.slice(0, 10)}`;

export function WalkForwardView({ result }: Props) {
  const { summary } = result;
  const accepted = result.windows.filter((w) => w.validationAccepted).length;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          Out-of-sample: parameters chosen on earlier windows, then tested on the window that follows
        </h3>
        <MetricGrid
          label="Walk-forward summary"
          items={[
            { label: "OOS return", value: percent(summary.oosReturnTotal), tone: signTone(summary.oosReturnTotal) },
            { label: "OOS Sharpe (avg)", value: summary.oosSharpeAvg.toFixed(2), tone: signTone(summary.oosSharpeAvg) },
            { label: "OOS max drawdown", value: percent(summary.oosDrawdownMax), tone: summary.oosDrawdownMax ? "text-bear" : "" },
            { label: "Retention vs in-sample", value: summary.performanceRetention == null ? "—" : percent(summary.performanceRetention, 1) },
            { label: "Walk-forward efficiency", value: summary.walkForwardEfficiency == null ? "—" : summary.walkForwardEfficiency.toFixed(2) },
            { label: "Windows accepted", value: `${accepted} of ${result.windows.length}` },
          ]}
        />
      </section>

      <section className="rounded border border-border bg-panel p-3">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">OOS equity, test windows joined</h3>
        <EquityLine
          label="Out-of-sample equity curve"
          height={200}
          points={(result.aggregateOosEquityCurve ?? []).map((p) => ({ time: p.timestamp, equity: p.equity }))}
        />
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Windows (train → validate → test)</h3>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="border-b border-border bg-panel text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Train</th>
                <th className="px-3 py-1.5 font-medium">Validate</th>
                <th className="px-3 py-1.5 font-medium">Test (OOS)</th>
                <th className="px-3 py-1.5 font-medium">Chosen parameters</th>
                <th className="px-3 py-1.5 text-right font-medium">IS Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">Val Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS Sharpe</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS return</th>
                <th className="px-3 py-1.5 text-right font-medium">OOS max DD</th>
                <th className="px-3 py-1.5 font-medium">Validation</th>
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
                    {Object.entries(w.selectedParameters).map(([name, value]) => `${name} ${value}`).join(", ")}
                  </td>
                  <td className="px-3 py-1.5 text-right">{w.isMetrics.sharpe.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right">{w.valMetrics ? w.valMetrics.sharpe.toFixed(2) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right ${signTone(w.oosMetrics?.sharpe)}`}>{w.oosMetrics ? w.oosMetrics.sharpe.toFixed(2) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right ${signTone(w.oosMetrics?.totalReturn)}`}>{w.oosMetrics ? percent(w.oosMetrics.totalReturn, 1) : "—"}</td>
                  <td className="px-3 py-1.5 text-right text-bear">{w.oosMetrics ? percent(w.oosMetrics.maxDrawdown, 1) : "—"}</td>
                  <td className={`px-3 py-1.5 font-sans ${w.validationAccepted ? "text-bull" : "text-bear"}`}>
                    {w.validationAccepted ? "Accepted" : "Rejected"}
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
