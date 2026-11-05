export interface MetricRow {
  label: string;
  value: string;
  /** > 0 renders bullish, < 0 bearish, 0 neutral. */
  trend: number;
  /** Tooltip explaining a value that is not a number. */
  hint?: string;
}

/**
 * Profit factor and payoff ratio divide by losses, so they are undefined when no trade lost: the
 * API sends null (older deployments sent Infinity, which JSON also delivers as null).
 */
export function ratioMetric(label: string, value: number | null | undefined): MetricRow {
  if (value == null || !Number.isFinite(value)) {
    return { label, value: "—", trend: 0, hint: "No losing trades" };
  }
  return { label, value: value.toFixed(2), trend: value - 1 };
}
