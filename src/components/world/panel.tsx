import type { ReactNode } from "react";
import type { SourceStatus } from "@shared/world/contracts";

export function formatIST(value: string): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatISTDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });
}

export function WorldPanel({
  title,
  sources,
  children,
  className = "",
  attribution,
}: {
  title: string;
  sources: readonly SourceStatus[];
  children: ReactNode;
  className?: string;
  attribution?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`min-w-0 overflow-hidden rounded-sm border border-border bg-panel ${className}`}
    >
      <h2 className="border-b border-border px-3 py-2 text-tv-sm font-semibold">{title}</h2>
      {children}
      <footer className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        {sources.map((status) => (
          <span key={status.source}>
            {status.source} ·{" "}
            {status.fetchedAt ? `updated ${formatIST(status.fetchedAt)} IST` : "not yet available"}
          </span>
        ))}
        {attribution}
      </footer>
    </section>
  );
}

export function SourceWarnings({
  sources,
  retry,
}: {
  sources: readonly SourceStatus[];
  retry: () => void;
}) {
  return (
    <>
      {sources
        .filter((status) => status.error || status.stale)
        .map((status) => (
          <div
            role="status"
            key={status.source}
            className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground"
          >
            <span>
              {status.source}:{" "}
              {status.stale && status.fetchedAt
                ? `Showing data from ${formatIST(status.fetchedAt)}; source unavailable`
                : (status.error ?? "Source unavailable")}
            </span>
            <button type="button" className="shrink-0 text-primary hover:underline" onClick={retry}>
              Retry
            </button>
          </div>
        ))}
    </>
  );
}

export function QueryError({ error, retry }: { error: Error | null; retry: () => void }) {
  return error ? (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <span>{error.message}</span>
      <button type="button" className="text-primary hover:underline" onClick={retry}>
        Retry
      </button>
    </div>
  ) : null;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div aria-label="Loading data" className="space-y-3 p-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-7 animate-pulse rounded-sm bg-muted" />
      ))}
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-xs text-muted-foreground">{children}</p>;
}
