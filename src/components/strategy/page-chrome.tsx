import type { ReactNode } from "react";

/** Header row shared by the Strategy Lab, research, performance and replay pages. */
export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
  );
}

/** Segmented view switcher; each option is a toggle button. */
export function ViewSwitch<T extends string>({ options, value, onChange, label }: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            value === option.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const primaryButton =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
export const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40";

/** A failed request, stated once and compactly. */
export function ErrorLine({ title, error }: { title: string; error: { message: string } | string }) {
  return (
    <p role="alert" className="rounded border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">
      {title}: {typeof error === "string" ? error : error.message}
    </p>
  );
}

/** One muted line where a list or panel has nothing to show. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

export interface MetricItem {
  label: string;
  value: string;
  /** Tailwind text colour class, e.g. text-bull. */
  tone?: string;
  /** Tooltip for values that need explaining (e.g. "—" when undefined). */
  hint?: string;
}

/** Dense label/value table for run metrics; values are right-aligned tabular numbers. */
export function MetricGrid({ items, label }: { items: MetricItem[]; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-1 border-l border-t border-border text-xs sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-r border-border px-3 py-1.5">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd title={item.hint} className={`font-mono tabular-nums ${item.tone ?? ""}`}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
