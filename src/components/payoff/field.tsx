import type { ReactNode } from "react";

export const INPUT_CLASS =
  "h-7 w-full min-w-0 rounded border border-border bg-background px-2 font-mono text-xs tabular-nums text-foreground outline-none transition-colors focus:border-primary/70 aria-[invalid=true]:border-bear/70 disabled:opacity-50";

/** Keeps a decimal draft typeable ("24", "24.", "24.5") while rejecting anything else. */
export function decimalDraft(value: string): string {
  const [whole = "", ...fraction] = value.replace(/[^\d.]/g, "").split(".");
  return fraction.length > 0 ? `${whole}.${fraction.join("")}` : whole;
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-tv-caps text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-[10px] leading-none text-bear">{error}</span>
      ) : hint ? (
        <span className="text-[10px] leading-none text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}
