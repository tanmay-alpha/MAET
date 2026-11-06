import type {
  DrawdownResult,
  MetricResult,
  PortfolioAnalyticsResult,
} from "@/hooks/use-portfolio-analytics";

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function MetricRow({ label, metric, format, detail, signed }: {
  label: string;
  metric: MetricResult;
  format: (value: number) => string;
  detail?: string;
  /** Colour the value by its sign. */
  signed?: boolean;
}) {
  const value = metric.value;
  const tone = !signed || value === null || value === 0 ? "" : value > 0 ? "text-bull" : "text-bear";
  return (
    <div className="py-1.5 border-b border-border/40 last:border-0">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-semibold ${tone}`} title={metric.reason ?? undefined}>
          {value === null ? "—" : format(value)}
        </span>
      </div>
      {value === null && metric.reason ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{metric.reason}</div>
      ) : detail ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function drawdownDetail(drawdown: DrawdownResult): string | undefined {
  if (!drawdown.peakDate || !drawdown.troughDate) return drawdown.value === 0 ? "No drawdown yet" : undefined;
  const recovery = drawdown.recoveryDate ? `recovered ${drawdown.recoveryDate}` : "not yet recovered";
  return `Peak ${drawdown.peakDate} → trough ${drawdown.troughDate}, ${recovery}`;
}

/**
 * Metrics of the paper account's daily equity curve, computed on the server
 * from end-of-day snapshots. Metrics the history cannot support are shown as
 * unavailable with the server's reason rather than as zeros.
 */
export function PortfolioPerformancePanel({ performance, isLoading, error }: {
  performance: PortfolioAnalyticsResult | undefined;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return <div className="h-40 rounded border border-border bg-panel/80 animate-pulse" />;
  }
  if (error || !performance) {
    return <div className="text-xs text-bear">Performance metrics unavailable: {error ?? "no response"}</div>;
  }
  if (!performance.account) {
    return <div className="text-xs text-muted-foreground">{performance.reason ?? "No paper trading account yet"}</div>;
  }

  const { metrics, curve } = performance;
  const latest = curve[curve.length - 1];
  const insufficient = metrics.snapshotCount < 2;
  return (
    <div className="space-y-2 text-xs">
      <div className="text-[11px] text-muted-foreground">
        {metrics.snapshotCount === 0
          ? "No daily snapshots yet for this account."
          : `${metrics.snapshotCount} daily snapshot${metrics.snapshotCount === 1 ? "" : "s"} (${metrics.firstDate} – ${metrics.lastDate}), ${metrics.dailyReturnsCount} daily return${metrics.dailyReturnsCount === 1 ? "" : "s"}`}
      </div>
      {insufficient && (
        <div className="rounded border border-border bg-accent/30 px-2 py-1.5 text-[11px] text-muted-foreground">
          Insufficient history: metrics need at least 2 daily snapshots. A snapshot is recorded after each NSE close
          (15:45 IST).
        </div>
      )}
      <div>
        <MetricRow label="Total return" metric={metrics.totalReturn} format={formatPct} signed />
        <MetricRow label="CAGR" metric={metrics.cagr} format={formatPct} signed />
        <MetricRow label="Volatility (ann.)" metric={metrics.volatility} format={(v) => `${(v * 100).toFixed(2)}%`} />
        <MetricRow
          label="Sharpe"
          metric={metrics.sharpe}
          format={(v) => v.toFixed(2)}
          detail={`Risk-free rate ${(metrics.riskFreeRate * 100).toFixed(2)}%`}
          signed
        />
        <MetricRow
          label="Max drawdown"
          metric={metrics.maxDrawdown}
          format={(v) => `${(v * 100).toFixed(2)}%`}
          detail={drawdownDetail(metrics.maxDrawdown)}
        />
      </div>
      {metrics.staleSnapshotCount > 0 && (
        <div className="text-[11px] text-amber-500">
          {metrics.staleSnapshotCount} snapshot{metrics.staleSnapshotCount === 1 ? "" : "s"} valued open positions
          without a price from that session (stale or missing quotes).
        </div>
      )}
      {latest && !latest.isFinal && (
        <div className="text-[11px] text-muted-foreground">
          The {latest.date} point is intraday and is replaced by the closing snapshot after 15:45 IST.
        </div>
      )}
    </div>
  );
}
