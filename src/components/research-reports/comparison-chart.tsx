import { useId, useState } from "react";
import { chartGeometry } from "./selection";

/**
 * Line styles per compared run: Okabe-Ito colours (distinguishable with common colour-vision
 * deficiencies) plus a distinct dash pattern, so runs never rely on colour alone.
 */
export const RUN_STYLES = [
  { color: "#0072B2", dash: undefined, name: "solid" },
  { color: "#E69F00", dash: "6 3", name: "dashed" },
  { color: "#009E73", dash: "2 2", name: "dotted" },
  { color: "#CC79A7", dash: "8 3 2 3", name: "dash-dot" },
] as const;

export interface ChartRun {
  label: string;
  values: number[];
}

/** A small swatch drawn in the run's line style, for legends and table headers. */
export function RunSwatch({ index }: { index: number }) {
  const style = RUN_STYLES[index % RUN_STYLES.length];
  return (
    <svg width="22" height="8" aria-hidden className="inline-block shrink-0 align-middle">
      <line x1="1" x2="21" y1="4" y2="4" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
    </svg>
  );
}

/**
 * Several runs on one set of common dates, with a described image for screen readers and a
 * data table alternative behind a toggle.
 */
export function ComparisonChart({ title, dates, runs, format, reference, height = 220 }: {
  title: string;
  dates: string[];
  runs: ChartRun[];
  format: (value: number) => string;
  /** A horizontal reference value (e.g. 100 for rebased equity, 0 for drawdown). */
  reference?: number;
  height?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const tableId = useId();
  const geometry = chartGeometry(reference === undefined ? runs.map((r) => r.values) : [...runs.map((r) => r.values), [reference]]);
  const lines = geometry.lines.slice(0, runs.length);
  const referenceY = reference === undefined ? null : geometry.scaleY(reference);
  const summary = runs
    .map((r) => `${r.label} ends at ${r.values.length ? format(r.values[r.values.length - 1]) : "no value"}`)
    .join("; ");
  const description = dates.length
    ? `${title} for ${runs.length} runs from ${dates[0]} to ${dates[dates.length - 1]}, range ${format(geometry.min)} to ${format(geometry.max)}. ${summary}.`
    : `${title}: no common dates to chart.`;

  return (
    <figure aria-labelledby={titleId} className="rounded border border-border bg-panel p-3">
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span id={titleId} className="text-xs font-medium text-muted-foreground">{title}</span>
        <button
          type="button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <div className="relative font-mono text-[10px] text-muted-foreground" style={{ height }}>
        <svg role="img" aria-label={description} viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-0 top-4 bottom-4 h-[calc(100%-2rem)] w-full">
          {[0, 25, 50, 75, 100].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {referenceY !== null && (
            <line x1="0" x2="100" y1={referenceY} y2={referenceY} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />
          )}
          {lines.map((points, i) => {
            const style = RUN_STYLES[i % RUN_STYLES.length];
            if (runs[i].values.length === 1) {
              const [x, y] = points.split(",").map(Number);
              return <circle key={i} cx={x} cy={y} r="1.5" fill={style.color} />;
            }
            return (
              <polyline key={i} points={points} fill="none" stroke={style.color} strokeWidth="1.5" strokeDasharray={style.dash} vectorEffect="non-scaling-stroke" />
            );
          })}
        </svg>
        <span className="absolute left-0 top-0" aria-hidden>{format(geometry.max)}</span>
        <span className="absolute bottom-0 left-0" aria-hidden>{dates[0] ?? ""} · low {format(geometry.min)}</span>
        <span className="absolute bottom-0 right-0" aria-hidden>{dates[dates.length - 1] ?? ""}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={`${title} legend`}>
        {runs.map((r, i) => (
          <li key={r.label + i} className="flex items-center gap-1.5">
            <RunSwatch index={i} />
            <span>{r.label}</span>
            <span className="sr-only">({RUN_STYLES[i % RUN_STYLES.length].name} line)</span>
          </li>
        ))}
      </ul>
      <div id={tableId} hidden={!showTable} className="mt-2 max-h-72 overflow-auto">
        {showTable && (
          <table className="w-full whitespace-nowrap text-xs">
            <caption className="sr-only">{title} by date</caption>
            <thead className="sticky top-0 border-b border-border bg-panel text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-medium">Date</th>
                {runs.map((r, i) => <th key={r.label + i} scope="col" className="px-2 py-1 text-right font-medium">{r.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {dates.map((date, d) => (
                <tr key={date}>
                  <th scope="row" className="px-2 py-0.5 text-left font-normal">{date}</th>
                  {runs.map((r, i) => <td key={i} className="px-2 py-0.5 text-right">{format(r.values[d])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </figure>
  );
}
