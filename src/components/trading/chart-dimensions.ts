/**
 * Pane sizes of LightweightChart. Kept outside lightweight-chart.tsx so the lazy chart
 * wrapper can reserve the same space without importing lightweight-charts.
 */
export const RSI_PANE_HEIGHT = 120;
const MIN_MAIN_PANE_HEIGHT = 260;
// The RSI pane sits under a 1px top border.
const RSI_PANE_BORDER = 1;
// The chart frame has a 1px border on every side.
const FRAME_BORDER = 2;

/** Height of the price pane; the RSI pane takes its share from `height` when shown. */
export function mainPaneHeight(height: number, rsi = false): number {
  return rsi ? Math.max(height - RSI_PANE_HEIGHT, MIN_MAIN_PANE_HEIGHT) : height;
}

/** Outer height of the whole chart frame, borders included. */
export function chartFrameHeight(height: number, rsi = false): number {
  return mainPaneHeight(height, rsi) + (rsi ? RSI_PANE_HEIGHT + RSI_PANE_BORDER : 0) + FRAME_BORDER;
}
