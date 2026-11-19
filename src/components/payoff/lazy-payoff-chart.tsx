import { lazy, Suspense } from "react";
import { ChartLoading } from "@/components/chart/chart-loading";
import type { PayoffChartProps } from "./payoff-chart";

// The payoff route imports this module, so in the browser recharts starts downloading with
// the route instead of after the first valid strategy is entered.
// A failed prefetch is dropped: the lazy render below imports again and surfaces the error.
if (typeof window !== "undefined") import("./payoff-chart").catch(() => undefined);

const PayoffChart = lazy(() => import("./payoff-chart").then((module) => ({ default: module.PayoffChart })));

/** PayoffChart with recharts split out of the route bundle. */
export function LazyPayoffChart(props: PayoffChartProps) {
  return (
    <Suspense fallback={<ChartLoading style={{ height: props.height }} />}>
      <PayoffChart {...props} />
    </Suspense>
  );
}
