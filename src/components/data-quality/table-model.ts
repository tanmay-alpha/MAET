import type { Freshness, SymbolQualityRow } from "../../../server/modules/data-quality/contracts";

export type SortKey = "symbol" | "freshness" | "sessionsBehind" | "missingSessions" | "invalidBars" | "lastQuoteAt";
export type SortDirection = "asc" | "desc";
export type RowFilter = "all" | Freshness | "invalid";

/** Worst first when sorted descending. */
const FRESHNESS_RANK: Record<Freshness, number> = { fresh: 0, stale: 1, missing: 2 };

export function filterRows(rows: readonly SymbolQualityRow[], query: string, filter: RowFilter): SymbolQualityRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "invalid" ? row.invalidBars === 0 : filter !== "all" && row.freshness !== filter) return false;
    return needle === "" || row.symbol.toLowerCase().includes(needle) || (row.name?.toLowerCase().includes(needle) ?? false);
  });
}

function sortValue(row: SymbolQualityRow, key: SortKey): number | string | null {
  switch (key) {
    case "symbol":
      return row.symbol;
    case "freshness":
      return FRESHNESS_RANK[row.freshness];
    case "sessionsBehind":
      return row.sessionsBehind;
    case "missingSessions":
      return row.missingSessions;
    case "invalidBars":
      return row.invalidBars;
    case "lastQuoteAt":
      return row.lastQuoteAt;
  }
}

/** Stable sort; rows without a value (no candles, no quote) always go last. Ties fall back to symbol. */
export function sortRows(rows: readonly SymbolQualityRow[], key: SortKey, direction: SortDirection): SymbolQualityRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return (left < right ? -1 : 1) * sign;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}
