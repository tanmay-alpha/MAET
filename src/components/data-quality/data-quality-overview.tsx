export interface IngestionBatch {
  id: string;
  batchId: string;
  source: string;
  dataType: string;
  startedAt: string;
  status: string;
}

export interface DataQualityOverviewProps {
  overview: {
    totalAudits: number;
    openAnomalies: number;
    recentBatches: IngestionBatch[];
  } | null;
  coverage: {
    companiesWithQuotes: number;
    companiesWithFundamentals: number;
    lastIngestion: string | null;
  } | null;
  onRetryBatch?: (batchId: string) => void;
}

const STATUS_CLASS: Record<string, string> = {
  succeeded: "text-bull",
  failed: "text-bear",
};

function count(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-IN");
}

export function DataQualityOverviewComponent({ overview, coverage, onRetryBatch }: DataQualityOverviewProps) {
  const batches = overview?.recentBatches ?? [];
  return (
    <div className="space-y-3">
      <p className="font-mono text-xs tabular-nums text-muted-foreground">
        {count(overview?.totalAudits)} audits · <span className={overview?.openAnomalies ? "text-amber-400" : undefined}>{count(overview?.openAnomalies)} open anomalies</span> · quotes for {count(coverage?.companiesWithQuotes)} companies · fundamentals for {count(coverage?.companiesWithFundamentals)}
        {coverage?.lastIngestion ? ` · last ingestion ${new Date(coverage.lastIngestion).toLocaleString("en-IN")}` : ""}
      </p>

      {batches.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recent ingestion batches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Batch</th>
                <th className="py-1.5 pr-3 font-medium">Source / type</th>
                <th className="py-1.5 pr-3 font-medium">Started</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3 font-mono">{batch.batchId}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{batch.source} / {batch.dataType}</td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground">{new Date(batch.startedAt).toLocaleString("en-IN")}</td>
                  <td className="py-1.5">
                    <span className={STATUS_CLASS[batch.status] ?? "text-amber-400"}>{batch.status}</span>
                    {batch.status === "failed" && onRetryBatch && (
                      <button type="button" onClick={() => onRetryBatch(batch.batchId)} className="ml-3 text-primary hover:underline">
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
