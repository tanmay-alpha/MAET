import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/data-quality/summary-cards";
import { SymbolQualityTable } from "@/components/data-quality/symbol-quality-table";
import { PipelineGapsPanel } from "@/components/data-quality/pipeline-gaps-panel";
import { formatIst } from "@/components/data-quality/badges";
import type { DataQualityUniverse } from "../../server/modules/data-quality/contracts";

export const Route = createFileRoute("/_app/data-quality")({
  head: () => ({ meta: [{ title: "Data quality — MAET" }] }),
  component: DataQualityPage,
});

const UNIVERSES: Array<{ value: DataQualityUniverse; label: string }> = [
  { value: "nifty50", label: "Nifty 50" },
  { value: "active", label: "Top 200 by market cap" },
];

function DataQualityPage() {
  const [universe, setUniverse] = useState<DataQualityUniverse>("nifty50");
  const report = useQuery({
    queryKey: ["dataQuality", "publicReport", universe],
    queryFn: () => trpc.dataQuality.getPublicReport.query({ universe }),
    retry: 1,
    staleTime: 60_000,
  });
  const data = report.data;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto max-w-7xl space-y-3 px-3 py-4 sm:px-6 sm:py-6">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-3">
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold">Market data quality</h1>
            <p className="text-xs text-muted-foreground">
              Freshness and completeness of the stored daily candles, quotes and fundamentals that charts, the screener and backtests read.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Universe
              <select
                value={universe}
                onChange={(event) => setUniverse(event.target.value as DataQualityUniverse)}
                className="h-8 rounded border border-input bg-background px-2 text-xs text-foreground"
              >
                {UNIVERSES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void report.refetch()}
              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="Refresh report"
            >
              <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${report.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {report.isError && !data ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-bear/40 bg-bear/10 p-3 text-sm">
            <span>
              The data-quality report could not be loaded.{" "}
              <span className="text-muted-foreground">{report.error instanceof Error ? report.error.message : ""}</span>
            </span>
            <button type="button" onClick={() => void report.refetch()} className="rounded border border-border px-3 py-1 text-xs font-semibold hover:bg-accent">
              Retry
            </button>
          </div>
        ) : !data ? (
          <div aria-busy="true" aria-label="Loading report" className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20" />)}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" data-testid="report-meta">
              {data.universe.label} · {data.universe.symbolCount} symbols · source: stored database tables · latest completed NSE session{" "}
              <span className="font-mono text-foreground">{data.calendar.latestCompletedSession}</span> (IST) · gaps checked over the last{" "}
              {data.calendar.windowSessions} sessions · as of {formatIst(data.asOf)}
            </p>
            {data.symbols.length === 0 ? (
              <p role="status" className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                No symbols in this universe yet. The company master has not been loaded.
              </p>
            ) : (
              <SummaryCards report={data} />
            )}
            <PipelineGapsPanel gaps={data.pipelineGaps} />
            {data.symbols.length > 0 && <SymbolQualityTable rows={data.symbols} />}
            <p className="text-[11px] text-muted-foreground">
              Fresh: the latest daily bar is at most one NSE session behind. Stale: more than one session behind. Missing: no daily bar stored.
              Ingestion runs, queues and dead-letter stats are on the{" "}
              <Link to="/admin/data-quality" className="text-primary hover:underline">admin data status</Link> page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
