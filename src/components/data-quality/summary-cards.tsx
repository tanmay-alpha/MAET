import type { ReactNode } from "react";
import type { DataQualityReport } from "../../../server/modules/data-quality/contracts";
import { sourceName } from "@/lib/quote-source";
import { QuoteDelayBadge, formatIst } from "./badges";

function Card({ title, value, children }: { title: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card p-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
      {children && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function SummaryCards({ report }: { report: DataQualityReport }) {
  const { summary, calendar } = report;
  const lastQuote = summary.lastQuote;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Card title="Coverage" value={`${summary.coveragePct}%`}>
        {summary.withDailyCandles} of {summary.symbols} symbols have daily candles
      </Card>
      <Card
        title="Freshness"
        value={
          <span className="flex flex-wrap gap-x-2">
            <span className="text-bull">{summary.fresh}</span>
            <span className="text-amber-400">{summary.stale}</span>
            <span className="text-bear">{summary.missing}</span>
          </span>
        }
      >
        <span data-testid="freshness-counts">
          {summary.fresh} fresh · {summary.stale} stale · {summary.missing} missing
        </span>
      </Card>
      <Card title="Invalid bars" value={summary.invalidBars}>
        in {summary.symbolsWithInvalidBars} symbol{summary.symbolsWithInvalidBars === 1 ? "" : "s"} · {summary.zeroVolumeBars} zero-volume
      </Card>
      <Card title="Missing sessions" value={summary.missingSessions}>
        of {summary.expectedSessions} expected in the last {calendar.windowSessions} sessions
      </Card>
      <Card title="Last quote" value={lastQuote ? <span className="text-base">{formatIst(lastQuote.at)}</span> : "—"}>
        {lastQuote ? (
          <span className="flex flex-wrap items-center gap-1" data-testid="last-quote-source">
            {sourceName(lastQuote.source)} <QuoteDelayBadge delayed={lastQuote.delayed} />
          </span>
        ) : (
          "No stored quote snapshots"
        )}
      </Card>
      <Card title="Fundamentals" value={`${summary.fundamentalsCovered}/${summary.symbols}`}>
        {summary.fundamentalsMissingAvailability} rows without availability dates
      </Card>
    </section>
  );
}
