import type { IngestionBatchView } from "../../../server/modules/data-quality/contracts";
import { formatIst } from "./badges";

export interface IngestionBatchesProps {
  batches: IngestionBatchView[];
  onRetryBatch?: (batchId: string) => void;
}

const STATUS_CLASS: Record<string, string> = {
  succeeded: "text-bull",
  failed: "text-bear",
};

/** Recent ingestion_runs rows (admin), with a retry action for failed batches. */
export function IngestionBatches({ batches, onRetryBatch }: IngestionBatchesProps) {
  if (batches.length === 0) return <p className="text-xs text-muted-foreground">No ingestion batches recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-3 font-medium">Batch</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Source / type</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Started</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Retries</th>
            <th scope="col" className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-3 font-mono">{batch.batchId}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">{batch.source} / {batch.dataType}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{formatIst(batch.startedAt)}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{batch.retryCount}</td>
              <td className="py-1.5">
                <span className={STATUS_CLASS[batch.status] ?? "text-amber-400"}>{batch.status}</span>
                {batch.errorSummary && <span className="block max-w-xs truncate text-[11px] text-muted-foreground" title={batch.errorSummary}>{batch.errorSummary}</span>}
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
  );
}
