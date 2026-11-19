import { lazy, Suspense } from "react";
import { ChartLoading } from "@/components/chart/chart-loading";
import { chartFrameHeight } from "./chart-dimensions";
import type { CandlestickChartProps } from "./candlestick-chart";

// Chart routes import this module, so in the browser the chart chunk starts downloading
// with the route, in parallel with its data queries, instead of after the data arrives.
// A failed prefetch is dropped: the lazy render below imports again and surfaces the error.
if (typeof window !== "undefined") import("./candlestick-chart").catch(() => undefined);

const CandlestickChart = lazy(() => import("./candlestick-chart").then((module) => ({ default: module.CandlestickChart })));

/** CandlestickChart with lightweight-charts split out of the route bundle. */
export function LazyCandlestickChart(props: CandlestickChartProps) {
  const height = chartFrameHeight(props.height ?? 420, props.indicators?.rsi);
  return (
    <Suspense
      fallback={<ChartLoading className={`rounded-lg bg-[#0d1117] ${props.className ?? ""}`} style={{ height }} />}
    >
      <CandlestickChart {...props} />
    </Suspense>
  );
}
