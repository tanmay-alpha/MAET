import React from "react";

export interface DataQualityOverviewProps {
  overview: {
    totalAudits: number;
    openAnomalies: number;
    recentBatches: any[];
  } | null;
  coverage: {
    companiesWithQuotes: number;
    companiesWithFundamentals: number;
    lastIngestion: string | null;
  } | null;
  onRetryBatch?: (batchId: string) => void;
}

export function DataQualityOverviewComponent({ overview, coverage, onRetryBatch }: DataQualityOverviewProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Total Ingestion Audits</p>
          <p className="text-2xl font-bold">{overview?.totalAudits ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Open Anomalies</p>
          <p className="text-2xl font-bold text-amber-500">{overview?.openAnomalies ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Companies with Quotes</p>
          <p className="text-2xl font-bold">{coverage?.companiesWithQuotes ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Companies with Fundamentals</p>
          <p className="text-2xl font-bold">{coverage?.companiesWithFundamentals ?? 0}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Recent Ingestion Batches</h3>
        <div className="space-y-3">
          {overview?.recentBatches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent ingestion batches found.</p>
          ) : (
            overview?.recentBatches?.map((batch: any) => (
              <div key={batch.id} className="flex items-center justify-between border-b pb-3 text-xs">
                <div>
                  <span className="font-mono font-bold">{batch.batchId}</span>
                  <span className="ml-2 text-muted-foreground">({batch.source} / {batch.dataType})</span>
                  <p className="text-muted-foreground text-[10px]">{new Date(batch.startedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded uppercase font-semibold text-[10px] ${
                    batch.status === "succeeded" ? "bg-emerald-500/15 text-emerald-600" :
                    batch.status === "failed" ? "bg-rose-500/15 text-rose-600" : "bg-amber-500/15 text-amber-600"
                  }`}>
                    {batch.status}
                  </span>
                  {batch.status === "failed" && onRetryBatch && (
                    <button
                      onClick={() => onRetryBatch(batch.batchId)}
                      className="text-xs text-primary underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
