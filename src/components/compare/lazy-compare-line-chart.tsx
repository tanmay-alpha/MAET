import { lazy, Suspense } from "react";
import { ChartLoading } from "@/components/chart/chart-loading";
import type { CompareLineChartProps } from "./compare-line-chart";

// The compare route imports this module, so in the browser recharts starts downloading with
// the route, in parallel with the candle queries, instead of after they resolve.
// A failed prefetch is dropped: the lazy render below imports again and surfaces the error.
if (typeof window !== "undefined") import("./compare-line-chart").catch(() => undefined);

const CompareLineChart = lazy(() =>
  import("./compare-line-chart").then((module) => ({ default: module.CompareLineChart })),
);

/** CompareLineChart with recharts split out of the route bundle. Fills its parent's height. */
export function LazyCompareLineChart(props: CompareLineChartProps) {
  return (
    <Suspense fallback={<ChartLoading className="h-full" />}>
      <CompareLineChart {...props} />
    </Suspense>
  );
}
