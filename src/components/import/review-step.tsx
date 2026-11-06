import { useState } from "react";
import type { ImportAnalysis } from "@shared/domain/investing/import/analyse";
import type { RowResult } from "@shared/domain/investing/import/normalize";

/** Rendering every row of a multi-year tradebook would stall the page; counts still cover all rows. */
const MAX_SHOWN_ROWS = 500;

type Filter = "all" | RowResult["status"];

const STATUS_CLASS: Record<RowResult["status"], string> = {
  accepted: "text-bull",
  rejected: "text-bear",
  duplicate: "text-amber-400",
};

export function ReviewStep({ analysis, headers, onBack, onContinue }: {
  analysis: ImportAnalysis;
  headers: string[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(analysis.counts.rejected + analysis.counts.duplicates > 0 ? "rejected" : "all");
  const rows = filter === "all" ? analysis.rows : analysis.rows.filter((row) => row.status === filter);
  const shown = rows.slice(0, MAX_SHOWN_ROWS);
  const counts: Array<[Filter, string, number]> = [
    ["all", "Parsed", analysis.counts.parsed],
    ["accepted", "Accepted", analysis.counts.accepted],
    ["rejected", "Rejected", analysis.counts.rejected],
    ["duplicate", "Duplicates", analysis.counts.duplicates],
  ];

  return <section aria-labelledby="review-step-heading" className="border border-border bg-panel p-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="review-step-heading" className="text-sm font-semibold">Review rows</h2>
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="rounded border border-border px-3 py-1.5 hover:bg-accent">Change file</button>
        <button type="button" onClick={onContinue} disabled={analysis.counts.accepted === 0}
          className="rounded border border-primary bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">See results</button>
      </div>
    </div>
    <div role="group" aria-label="Row counts" className="mt-3 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
      {counts.map(([key, label, value]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
        className={`bg-panel px-3 py-2 text-left hover:bg-accent ${filter === key ? "outline outline-1 -outline-offset-1 outline-primary" : ""}`}>
        <span className="block text-muted-foreground">{label}</span>
        <span data-testid={`count-${key}`} className="font-mono text-base tabular-nums">{value}</span>
      </button>)}
    </div>
    <p className="mt-2 text-muted-foreground">Only accepted rows reach FIFO. Sells are checked in trade-date order against the quantity held at the time; F&amp;O and non-executed orders are excluded.</p>
    <div className="mt-2 max-h-[28rem] overflow-auto border border-border">
      <table className="w-full whitespace-nowrap text-left">
        <thead className="sticky top-0 bg-panel"><tr className="border-b border-border">
          <th className="px-2 py-1">Line</th><th className="px-2">Status</th><th className="px-2">Reason</th>
          {headers.map((header, index) => <th key={index} className="px-2 font-normal text-muted-foreground">{header}</th>)}
        </tr></thead>
        <tbody>{shown.map((row) => <tr key={row.line} className="border-b border-border/40">
          <td className="px-2 py-1 font-mono tabular-nums text-muted-foreground">{row.line}</td>
          <td className={`px-2 ${STATUS_CLASS[row.status]}`}>{row.status}</td>
          <td className="px-2">{row.reason ?? ""}</td>
          {headers.map((_, index) => <td key={index} className="px-2 font-mono">{row.cells[index] ?? ""}</td>)}
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="p-3 text-muted-foreground">No rows in this group.</p>}
      {rows.length > shown.length && <p className="p-3 text-muted-foreground">Showing the first {shown.length} of {rows.length} rows.</p>}
    </div>
  </section>;
}
