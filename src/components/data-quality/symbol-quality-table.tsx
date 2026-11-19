import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { BarIssue, SymbolQualityRow } from "../../../server/modules/data-quality/contracts";
import { sourceName } from "@/lib/quote-source";
import { FreshnessBadge, QuoteDelayBadge, formatIst } from "./badges";
import { filterRows, sortRows, type RowFilter, type SortDirection, type SortKey } from "./table-model";

const ISSUE_LABEL: Record<BarIssue, string> = {
  high_below_low: "high < low",
  open_outside_range: "open outside range",
  close_outside_range: "close outside range",
  non_positive_price: "price ≤ 0",
  negative_volume: "negative volume",
  missing_volume: "no volume",
  zero_volume: "zero volume",
};

const FILTERS: Array<{ value: RowFilter; label: string }> = [
  { value: "all", label: "All symbols" },
  { value: "fresh", label: "Fresh" },
  { value: "stale", label: "Stale" },
  { value: "missing", label: "Missing" },
  { value: "invalid", label: "With invalid bars" },
];

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={`px-2 py-2 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 whitespace-nowrap rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {label}
        <Icon aria-hidden="true" className={`h-3 w-3 ${active ? "text-foreground" : "opacity-50"}`} />
      </button>
    </th>
  );
}

export function SymbolQualityTable({ rows }: { rows: SymbolQualityRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "freshness", direction: "desc" });
  const searchId = useId();
  const filterId = useId();

  const visible = useMemo(() => sortRows(filterRows(rows, query, filter), sort.key, sort.direction), [rows, query, filter, sort]);
  const onSort = (key: SortKey) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  const headerProps = { sort, onSort };

  return (
    <section aria-labelledby="symbols-heading" className="min-w-0 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <h2 id="symbols-heading" className="mr-auto text-sm font-semibold">
          Symbols <span className="font-normal text-muted-foreground">({visible.length} of {rows.length})</span>
        </h2>
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={searchId} className="text-[11px] text-muted-foreground">Search</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Symbol or name"
            className="h-8 w-40 rounded border border-input bg-background px-2 text-xs"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor={filterId} className="text-[11px] text-muted-foreground">Show</label>
          <select
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value as RowFilter)}
            className="h-8 rounded border border-input bg-background px-2 text-xs"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">No symbols match this filter.</p>
      ) : (
        <div className="overflow-x-auto" data-testid="symbol-table-scroll">
          <table className="w-full min-w-[880px] text-xs">
            <caption className="sr-only">Daily candle freshness, gaps, invalid bars, quotes and fundamentals per symbol</caption>
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <SortHeader label="Symbol" column="symbol" {...headerProps} />
                <SortHeader label="Freshness" column="freshness" {...headerProps} />
                <SortHeader label="Latest bar" column="sessionsBehind" {...headerProps} />
                <SortHeader label="Missing sessions" column="missingSessions" {...headerProps} className="text-right" />
                <SortHeader label="Invalid bars" column="invalidBars" {...headerProps} />
                <SortHeader label="Last quote" column="lastQuoteAt" {...headerProps} />
                <th scope="col" className="px-2 py-2 font-medium">Fundamentals</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Corp. actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.symbol} data-testid="symbol-row" data-symbol={row.symbol} className="border-b border-border/60 align-top last:border-0">
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    <span className="font-mono font-medium">{row.symbol}</span>
                    {row.name && <span className="block max-w-[14rem] truncate text-[11px] text-muted-foreground">{row.name}</span>}
                  </th>
                  <td className="px-2 py-1.5"><FreshnessBadge freshness={row.freshness} /></td>
                  <td className="px-2 py-1.5 font-mono">
                    {row.latestCandleDate ?? "—"}
                    {row.sessionsBehind !== null && (
                      <span className="block text-[11px] text-muted-foreground">
                        {row.sessionsBehind === 0 ? "current" : `${row.sessionsBehind} session${row.sessionsBehind === 1 ? "" : "s"} behind`}
                        {row.candleSource ? ` · ${sourceName(row.candleSource)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    <span className={row.missingSessions > 0 ? "text-amber-400" : undefined}>{row.missingSessions}</span>
                    <span className="text-muted-foreground"> / {row.expectedSessions}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`font-mono tabular-nums ${row.invalidBars > 0 ? "text-bear" : ""}`}>{row.invalidBars}</span>
                    {row.zeroVolumeBars > 0 && <span className="ml-1 text-[11px] text-muted-foreground">+{row.zeroVolumeBars} zero-vol</span>}
                    {row.invalidSamples.map((sample) => (
                      <span key={sample.date} className="block text-[11px] text-muted-foreground">
                        {sample.date}: {sample.issues.map((issue) => ISSUE_LABEL[issue]).join(", ")}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.lastQuoteAt && row.quoteSource ? (
                      <>
                        <span className="font-mono">{formatIst(row.lastQuoteAt)}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          {sourceName(row.quoteSource)} {row.quoteDelayed !== null && <QuoteDelayBadge delayed={row.quoteDelayed} />}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No stored quote</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.fundamentals.latestPeriod ? (
                      <>
                        <span className="font-mono">{row.fundamentals.latestPeriod}</span>
                        <span className="ml-1 text-[11px] text-muted-foreground">{row.fundamentals.latestPeriodType}</span>
                        {row.fundamentals.rowsMissingAvailability > 0 && (
                          <span className="block text-[11px] text-amber-400">
                            {row.fundamentals.rowsMissingAvailability} of {row.fundamentals.financialRows} without availability date
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">None stored</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {row.corporateActions.count}
                    {row.corporateActions.latestExDate && (
                      <span className="block text-[11px] text-muted-foreground">last ex {row.corporateActions.latestExDate}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
