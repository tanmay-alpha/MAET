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
export function PortfolioPerformancePanel({ performance, isLoading, error, signedIn }: {
  performance: PortfolioAnalyticsResult | undefined;
  isLoading: boolean;
  error: string | null;
  signedIn: boolean;
}) {
  if (!signedIn) {
    return <div className="text-xs text-muted-foreground">Sign in to see your paper portfolio performance.</div>;
  }
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
  // Non-final points not counted as past provisional ones can only be today's intraday point.
  const latestIsTodaysIntraday =
    latest !== undefined && !latest.isFinal && curve.filter((point) => !point.isFinal).length > metrics.provisionalSnapshotCount;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return (
    <div className="space-y-2 text-xs">
      <div className="text-[11px] text-muted-foreground">
        {metrics.firstDate && metrics.lastDate && metrics.firstDate !== metrics.lastDate
          ? `All history of this account since it started or was reset: ${metrics.firstDate} – ${metrics.lastDate} (the chart period buttons do not change these figures). `
          : "Measured from the account's starting cash. "}
        {`${plural(metrics.snapshotCount, "daily snapshot")}, ${plural(metrics.dailyReturnsCount, "consecutive-session return")}.`}
      </div>
      {metrics.snapshotCount === 0 && (
        <div className="rounded border border-border bg-accent/30 px-2 py-1.5 text-[11px] text-muted-foreground">
          Insufficient history: no daily snapshot yet. One is recorded after each NSE close (15:45 IST), or when you open
          this page during a session.
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
      {metrics.gapCount > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {plural(metrics.gapCount, "trading session")} without a snapshot (the server was asleep). Returns across them
          count in total return and drawdown but not in volatility or Sharpe.
        </div>
      )}
      {metrics.staleSnapshotCount > 0 && (
        <div className="text-[11px] text-amber-500">
          {plural(metrics.staleSnapshotCount, "snapshot")} valued open positions without a closing price from that
          session (stale or missing quotes); shown in amber on the chart.
        </div>
      )}
      {metrics.provisionalSnapshotCount > 0 && (
        <div className="text-[11px] text-amber-500">
          {plural(metrics.provisionalSnapshotCount, "past snapshot")}{" "}
          {metrics.provisionalSnapshotCount === 1 ? "has" : "have"} only an intraday value: the server was asleep at that
          session's close. Shown hollow on the chart.
        </div>
      )}
      {latestIsTodaysIntraday && (
        <div className="text-[11px] text-muted-foreground">
          The {latest?.date} point is intraday and is replaced by the closing snapshot after 15:45 IST.
        </div>
      )}
    </div>
  );
}
