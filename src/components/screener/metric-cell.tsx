import type { ReactNode } from "react";
import { describeProvenance, formatMetric, type MetricUnit, type Provenance, type ProvenanceKind } from "@/lib/screener-format";

/** An explicit "—" for missing data: screen readers hear "Not available", hover shows why. */
export function MissingValue({ reason }: { reason: string }) {
  return (
    <span className="cursor-help select-none text-muted-foreground" title={reason} data-missing="">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not available</span>
    </span>
  );
}

/**
 * One numeric cell in its column unit. `tone` colours the value by sign (or by a custom rule),
 * and a missing value always renders as MissingValue, never 0.
 */
export function MetricCell({
  value,
  unit,
  reason,
  signed,
  tone,
}: {
  value: number | null | undefined;
  unit: MetricUnit;
  reason: string;
  signed?: boolean;
  tone?: "sign" | ((value: number) => string);
}) {
  const text = formatMetric(value, unit, { signed });
  if (text === null || value === null || value === undefined) return <MissingValue reason={reason} />;
  const className = tone === "sign" ? (value >= 0 ? "text-bull" : "text-bear") : tone ? tone(value) : undefined;
  return <span className={className}>{text}</span>;
}

const KIND_LABEL: Record<ProvenanceKind, string> = { price: "Price", fundamentals: "Fundamentals" };

function StaleTag() {
  return (
    <span className="ml-1 rounded border border-amber-500/40 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-400">
      Stale
    </span>
  );
}

/** "Price: Angel One · live · 06 Nov, 15:45 IST", with a Stale tag when old. */
export function ProvenanceLine({ kind, provenance }: { kind: ProvenanceKind; provenance: Provenance | null }): ReactNode {
  return (
    <span className="block whitespace-nowrap">
      <span className="text-muted-foreground">{KIND_LABEL[kind]}: </span>
      <span className={provenance ? undefined : "text-muted-foreground"}>{describeProvenance(provenance, kind)}</span>
      {provenance?.stale && <StaleTag />}
    </span>
  );
}
