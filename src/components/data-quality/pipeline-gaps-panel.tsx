import type { PipelineGap } from "../../../server/modules/data-quality/contracts";
import { SeverityBadge } from "./badges";

export function PipelineGapsPanel({ gaps }: { gaps: PipelineGap[] }) {
  return (
    <section aria-labelledby="pipeline-gaps-heading" className="rounded-md border border-border bg-card p-3">
      <h2 id="pipeline-gaps-heading" className="text-sm font-semibold">
        Pipeline gaps <span className="font-normal text-muted-foreground">({gaps.length})</span>
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Structural problems detected from the tables themselves, not per-symbol issues.</p>
      {gaps.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No structural gaps detected.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {gaps.map((gap) => (
            <li key={gap.id} data-testid="pipeline-gap" data-gap-id={gap.id} className="flex flex-col gap-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-3">
              <SeverityBadge severity={gap.severity} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{gap.title}</p>
                <p className="break-words text-xs text-muted-foreground">{gap.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
