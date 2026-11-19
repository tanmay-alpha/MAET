/** Run selection for the comparison page: 2-4 distinct job ids carried as `?runs=a,b,c`. */

export const MIN_COMPARE_RUNS = 2;
export const MAX_COMPARE_RUNS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CompareSearch {
  /** Comma-separated job ids; kept as one string so shared URLs stay readable. */
  runs?: string;
}

/** Valid, distinct run ids from a `runs` value, at most MAX_COMPARE_RUNS, in order. */
export function compareRunIds(runs: unknown): string[] {
  const raw = typeof runs === "string" ? runs.split(",") : [];
  const ids = [...new Set(raw.map((id) => id.trim().toLowerCase()).filter((id) => UUID.test(id)))];
  return ids.slice(0, MAX_COMPARE_RUNS);
}

/** Route search validator: keeps only the valid run ids, dropping the param when none are left. */
export function parseCompareSearch(search: Record<string, unknown>): CompareSearch {
  const ids = compareRunIds(search.runs);
  return ids.length ? { runs: ids.join(",") } : {};
}

/** Adds or removes `id`; adding beyond MAX_COMPARE_RUNS leaves the selection unchanged. */
export function toggleRun(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return selected.length >= MAX_COMPARE_RUNS ? [...selected] : [...selected, id];
}

/**
 * SVG polyline points for several series on one shared 0-100 x 0-100 viewBox, plus the value range
 * they were scaled to. Every series is spread over the same x positions (they share dates).
 */
export function chartGeometry(series: ReadonlyArray<readonly number[]>): {
  min: number;
  max: number;
  lines: string[];
  /** viewBox y of a value on this scale. */
  scaleY: (value: number) => number;
} {
  const finite = series.flat().filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: 0, lines: series.map(() => ""), scaleY: () => 50 };
  const min = finite.reduce((a, b) => Math.min(a, b));
  const max = finite.reduce((a, b) => Math.max(a, b));
  // A flat range (e.g. a single common date) sits mid-height rather than on the bottom edge.
  const scaleY = (v: number) => (max === min ? 50 : 100 - ((v - min) / (max - min)) * 100);
  const lines = series.map((values) =>
    values.map((v, i) => `${(values.length === 1 ? 50 : (i / (values.length - 1)) * 100).toFixed(3)},${scaleY(v).toFixed(3)}`).join(" "),
  );
  return { min, max, lines, scaleY };
}
