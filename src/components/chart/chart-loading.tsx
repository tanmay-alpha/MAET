import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Suspense fallback for a lazily loaded chart. Callers size it to the chart it stands in
 * for, so the layout does not move when the chart library arrives.
 */
export function ChartLoading({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      role="status"
      className={cn("flex w-full items-center justify-center text-xs text-muted-foreground", className)}
      style={style}
    >
      Loading chart…
    </div>
  );
}
