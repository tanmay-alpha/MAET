import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { trpc, type IngestionRunSummary } from "@/lib/trpc";

const button =
  "inline-flex items-center rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
const confirmButton =
  "inline-flex items-center rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

const STATUS_CLASS: Record<IngestionRunSummary["status"], string> = {
  success: "text-bull",
  partial: "text-amber-400",
  failed: "text-bear",
};

/** The ingestion_runs row a manual trigger wrote, as the mutation reported it. */
function RunRow({ run }: { run: IngestionRunSummary }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs" data-testid="ingestion-run-row">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="py-1 pr-3 font-medium">Run</th>
            <th scope="col" className="py-1 pr-3 font-medium">Status</th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">Symbols ok / failed</th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">Records</th>
            <th scope="col" className="py-1 text-right font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1 pr-3 font-mono">{run.runId}</td>
            <td className={`py-1 pr-3 ${STATUS_CLASS[run.status]}`}>{run.status}</td>
            <td className="py-1 pr-3 text-right font-mono">{run.symbolsSucceeded} / {run.symbolsFailed}</td>
            <td className="py-1 pr-3 text-right font-mono">{run.recordsInserted}</td>
            <td className="py-1 text-right font-mono">{(run.durationMs / 1000).toFixed(1)} s</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Trigger({
  label,
  description,
  confirmText,
  run,
  disabled,
}: {
  label: string;
  description: string;
  confirmText: string;
  run: () => Promise<IngestionRunSummary>;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: run,
    // The new ingestion_runs row also shows in the batch list and reliability panel.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dataQuality"] }),
  });

  return (
    <div className="border-b border-border/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
        <div className="ml-auto flex items-center gap-2">
          {mutation.isPending ? (
            <span role="status" className="text-xs text-muted-foreground">Running…</span>
          ) : confirming ? (
            <>
              <span className="text-xs">{confirmText}</span>
              <button
                type="button"
                className={confirmButton}
                onClick={() => {
                  setConfirming(false);
                  mutation.mutate();
                }}
              >
                Confirm
              </button>
              <button type="button" className={button} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className={button} disabled={disabled} onClick={() => setConfirming(true)}>
              {label}
            </button>
          )}
        </div>
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-1 text-xs text-bear">{label} failed: {mutation.error.message}</p>
      )}
      {mutation.isSuccess && (
        <>
          <p role="status" className="mt-1 text-xs text-bull">{label} finished: {mutation.data.status}.</p>
          <RunRow run={mutation.data} />
        </>
      )}
    </div>
  );
}

/** Admin-only manual runs of the daily-bar and corporate-actions ingestion pipelines. */
export function IngestionTriggers({ defaultSymbols }: { defaultSymbols: readonly string[] }) {
  const [symbolText, setSymbolText] = useState(defaultSymbols.join(", "));
  const symbols = [...new Set(symbolText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];

  return (
    <div>
      <Trigger
        label="Run daily ingestion"
        description="Yahoo daily bars (365-day backfill) for the symbols below."
        confirmText={`Fetch daily bars for ${symbols.length} symbol${symbols.length === 1 ? "" : "s"}?`}
        disabled={symbols.length === 0 || symbols.length > 50}
        run={async () => (await trpc.ingestion.triggerRun.mutate({ source: "yahoo-history", symbols })).result}
      />
      <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Symbols (up to 50)
        <input
          value={symbolText}
          onChange={(event) => setSymbolText(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 font-mono text-foreground"
        />
      </label>
      <Trigger
        label="Run corporate actions ingestion"
        description="Yahoo dividends and splits for the tracked Nifty 50 list."
        confirmText="Fetch dividends and splits for every tracked symbol?"
        run={() => trpc.ingestion.triggerCorporateActions.mutate()}
      />
    </div>
  );
}
