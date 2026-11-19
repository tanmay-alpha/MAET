import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import type { Freshness, PipelineGapSeverity } from "../../../server/modules/data-quality/contracts";

const FRESHNESS: Record<Freshness, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  fresh: { label: "Fresh", className: "border-bull/40 bg-bull/10 text-bull", Icon: CheckCircle2 },
  stale: { label: "Stale", className: "border-amber-500/40 bg-amber-500/10 text-amber-400", Icon: Clock },
  missing: { label: "Missing", className: "border-bear/40 bg-bear/10 text-bear", Icon: XCircle },
};

/** Freshness as icon + word + colour, never colour alone. */
export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const { label, className, Icon } = FRESHNESS[freshness];
  return (
    <span
      data-testid="freshness-badge"
      data-freshness={freshness}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${className}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

const SEVERITY: Record<PipelineGapSeverity, { label: string; className: string; Icon: typeof Info }> = {
  critical: { label: "Critical", className: "border-bear/40 bg-bear/10 text-bear", Icon: AlertOctagon },
  warning: { label: "Warning", className: "border-amber-500/40 bg-amber-500/10 text-amber-400", Icon: AlertTriangle },
  info: { label: "Info", className: "border-border bg-muted text-muted-foreground", Icon: Info },
};

export function SeverityBadge({ severity }: { severity: PipelineGapSeverity }) {
  const { label, className, Icon } = SEVERITY[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

/** "Delayed" / "Real-time" label for a quote source. */
export function QuoteDelayBadge({ delayed }: { delayed: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
        delayed ? "border-amber-500/40 text-amber-400" : "border-bull/40 text-bull"
      }`}
    >
      {delayed ? "Delayed" : "Real-time"}
    </span>
  );
}

const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "06 Nov, 15:29 IST". */
export function formatIst(iso: string): string {
  return `${IST_DATE_TIME.format(new Date(iso))} IST`;
}
