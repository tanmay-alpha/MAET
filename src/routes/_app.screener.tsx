import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, RefreshCw, Search, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { ScreenerRow, type QuoteMap, type ScreenerColumn } from "@/components/screener/screener-row";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";
import type { WorkspaceSavedScreener } from "@/lib/trpc";
import { fetchMarketCompanies, type MarketCompany, type ScreenerQuery } from "@/lib/market-api";
import {
  activeScreenerPreset, applyScreenerPreset, arrangeLivePage, DEFAULT_SCREENER_SORT, LIVE_QUOTE_FILTER_KEYS, SCREENER_PRESETS,
} from "@/lib/screener-presets";
import { quoteSourceLabel } from "@/lib/quote-source";

export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type ViewId = "overview" | "performance" | "technicals" | "valuation" | "profitability" | "financials" | "balance" | "dividends";
type FilterState = Record<string, string>;
type LegacySavedView = {
  id: string;
  name: string;
  filters: FilterState;
  tab: ViewId;
  sortBy: string;
  sortDir: "asc" | "desc";
  hiddenColumns: string[];
  updatedAt: string;
};
type SavedScreenerCriteriaV1 = {
  schemaVersion: 1;
  filters: FilterState;
  view: ViewId;
  sortBy: string;
  sortDir: "asc" | "desc";
  hiddenColumns: string[];
};
type SavedScreenerView = {
  definition: WorkspaceSavedScreener;
  savedCriteria: SavedScreenerCriteriaV1 | null;
};

const PAGE_SIZE = 50;
const SAVED_KEY = "maet:screener-v4:views";
const FILTER_AVAILABILITY_KEY: Record<string, string> = {
  rel_volume_min: "relVolume", rel_volume_max: "relVolume",
  market_cap_min: "marketCap", market_cap_max: "marketCap",
  pe_min: "pe", pe_max: "pe", pb_min: "pb", pb_max: "pb",
  roe_min: "roe", roe_max: "roe", roce_min: "roce", roce_max: "roce",
  dividend_yield_min: "dividendYield", dividend_yield_max: "dividendYield",
  debt_to_equity_max: "debtToEquity", current_ratio_min: "currentRatio",
  sales_growth_min: "salesGrowth", profit_growth_min: "profitGrowth",
  rsi_min: "rsi", rsi_max: "rsi",
  distance_sma200_min: "sma200", distance_sma200_max: "sma200",
  distance_52w_high_min: "fiftyTwoWeekHigh", distance_52w_high_max: "fiftyTwoWeekHigh",
  atr_min: "atr", atr_max: "atr",
};
const NUMERIC_FILTERS = [
  ["price_min", "Min price"], ["price_max", "Max price"], ["change_pct_min", "Min change %"], ["change_pct_max", "Max change %"],
  ["volume_min", "Min volume"], ["volume_max", "Max volume"], ["rel_volume_min", "Min rel volume"], ["rel_volume_max", "Max rel volume"],
  ["market_cap_min", "Min market cap"], ["market_cap_max", "Max market cap"],
  ["pe_min", "Min P/E"], ["pe_max", "Max P/E"], ["pb_min", "Min P/B"], ["pb_max", "Max P/B"],
  ["roe_min", "Min ROE"], ["roe_max", "Max ROE"], ["roce_min", "Min ROCE"], ["roce_max", "Max ROCE"],
  ["dividend_yield_min", "Min dividend yield"], ["dividend_yield_max", "Max dividend yield"],
  ["debt_to_equity_max", "Max debt / equity"], ["current_ratio_min", "Min current ratio"],
  ["sales_growth_min", "Min sales growth"], ["profit_growth_min", "Min profit growth"],
  ["rsi_min", "Min RSI (14)"], ["rsi_max", "Max RSI (14)"],
  ["distance_sma200_min", "Min % from SMA200"], ["distance_sma200_max", "Max % from SMA200"],
  ["distance_52w_high_min", "Min % from 52W High"], ["distance_52w_high_max", "Max % from 52W High"],
  ["atr_min", "Min ATR (14)"], ["atr_max", "Max ATR (14)"],
] as const;

const TABS: Array<{ id: ViewId; label: string }> = [
  { id: "overview", label: "Overview" }, { id: "performance", label: "Performance" }, { id: "technicals", label: "Technicals" },
  { id: "valuation", label: "Valuation" }, { id: "profitability", label: "Profitability" }, { id: "financials", label: "Financials" },
  { id: "balance", label: "Balance Sheet" }, { id: "dividends", label: "Dividends" },
];

const VIEW_IDS = new Set<string>(TABS.map((tab) => tab.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFilters(value: unknown): FilterState | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, filterValue]) => typeof filterValue === "string")) return null;
  return Object.fromEntries(entries) as FilterState;
}

function parseSavedCriteria(value: unknown): SavedScreenerCriteriaV1 | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  const filters = parseFilters(value.filters);
  if (
    !filters ||
    typeof value.view !== "string" ||
    !VIEW_IDS.has(value.view) ||
    typeof value.sortBy !== "string" ||
    (value.sortDir !== "asc" && value.sortDir !== "desc") ||
    !Array.isArray(value.hiddenColumns) ||
    !value.hiddenColumns.every((column) => typeof column === "string")
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    filters,
    view: value.view as ViewId,
    sortBy: value.sortBy,
    sortDir: value.sortDir,
    hiddenColumns: [...new Set(value.hiddenColumns)],
  };
}

function createSavedCriteria(
  filters: FilterState,
  view: ViewId,
  sortBy: string,
  sortDir: "asc" | "desc",
  hiddenColumns: string[],
): SavedScreenerCriteriaV1 {
  const normalizedFilters = Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value.trim().length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    schemaVersion: 1,
    filters: normalizedFilters,
    view,
    sortBy,
    sortDir,
    hiddenColumns: [...new Set(hiddenColumns)].sort(),
  };
}

function savedCriteriaKey(criteria: SavedScreenerCriteriaV1): string {
  return JSON.stringify(createSavedCriteria(
    criteria.filters,
    criteria.view,
    criteria.sortBy,
    criteria.sortDir,
    criteria.hiddenColumns,
  ));
}

function parseLegacySavedView(value: unknown): LegacySavedView | null {
  if (!isRecord(value)) return null;
  const filters = parseFilters(value.filters);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !filters ||
    typeof value.tab !== "string" ||
    !VIEW_IDS.has(value.tab) ||
    typeof value.sortBy !== "string" ||
    (value.sortDir !== "asc" && value.sortDir !== "desc") ||
    !Array.isArray(value.hiddenColumns) ||
    !value.hiddenColumns.every((column) => typeof column === "string") ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name.trim(),
    filters,
    tab: value.tab as ViewId,
    sortBy: value.sortBy,
    sortDir: value.sortDir,
    hiddenColumns: [...new Set(value.hiddenColumns)],
    updatedAt: value.updatedAt,
  };
}

function loadLegacySavedViews(): LegacySavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.map(parseLegacySavedView).filter((view): view is LegacySavedView => view !== null)
      : [];
  } catch {
    return [];
  }
}

function numberValue(value: number | undefined, options?: Intl.NumberFormatOptions): string {
  return value === undefined ? "—" : value.toLocaleString("en-IN", options ?? { maximumFractionDigits: 2 });
}

function money(value: number | undefined): string {
  if (value === undefined) return "—";
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  return `₹${numberValue(value)}`;
}

function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function Missing({ reason }: { reason: string }) {
  return <span className="cursor-help select-none text-muted-foreground" title={reason}>—</span>;
}

function DataCell({ value, reason, mode = "number" }: { value?: number; reason: string; mode?: "number" | "money" | "percent" }) {
  if (value === undefined) return <Missing reason={reason} />;
  return <span>{mode === "money" ? money(value) : mode === "percent" ? percent(value) : numberValue(value)}</span>;
}

function quoteFor(company: MarketCompany, quotes: QuoteMap) {
  return quotes.get(company.symbol);
}

function reasonFor(company: MarketCompany, field: string, fallback: string): string {
  if (company.staleFundamentals) return `${fallback}. The latest stored fundamentals snapshot is stale.`;
  return fallback;
}

function buildColumns(view: ViewId): ScreenerColumn[] {
  const price: ScreenerColumn = { id: "price", label: "Price", align: "right", sortBy: "price", offline: true, render: (c, q) => <DataCell value={quoteFor(c, q)?.price ?? c.price} reason="Price unavailable: no persisted or reachable quote snapshot" mode="money" /> };
  const change: ScreenerColumn = { id: "changePct", label: "Chg %", align: "right", sortBy: "change_pct", offline: true, render: (c, q) => { const value = quoteFor(c, q)?.changePct ?? c.changePct; return value === undefined ? <Missing reason="Change unavailable: previous close was not supplied by the verified quote source" /> : <span className={value >= 0 ? "text-bull" : "text-bear"}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</span>; } };
  const volume: ScreenerColumn = { id: "volume", label: "Volume", align: "right", sortBy: "volume", offline: true, render: (c, q) => <DataCell value={quoteFor(c, q)?.volume ?? c.volume} reason="Volume unavailable from the latest verified quote snapshot" /> };
  const marketCap: ScreenerColumn = { id: "marketCap", label: "Market cap", align: "right", sortBy: "market_cap", render: (c) => <DataCell value={c.marketCap} reason="Market cap unavailable: no verified stored fundamentals value" mode="money" /> };
  const relVolume: ScreenerColumn = { id: "relVolume", label: "Rel volume", align: "right", sortBy: "rel_volume", render: (c) => <DataCell value={c.relVolume} reason="Relative volume unavailable: 20-day average volume not yet computed" /> };
  // ScreenerRow renders these two itself.
  const base: ScreenerColumn[] = [
    { id: "rank", label: "#", offline: true, cellClass: "hidden sm:table-cell", render: () => null },
    { id: "company", label: "Company", sortBy: "symbol", offline: true, render: () => null },
  ];
  const columns: Record<ViewId, ScreenerColumn[]> = {
    overview: [...base, price, change, volume, marketCap,
      { id: "sector", label: "Sector", sortBy: "sector", render: (c) => c.sector ?? <Missing reason="Sector unavailable from the verified NSE/company snapshot" /> },
      { id: "isin", label: "ISIN", offline: true, render: (c) => c.isin || <Missing reason="ISIN missing from the NSE company master" /> },
    ],
    performance: [...base, price, change, volume, relVolume,
      { id: "high52", label: "52W high", align: "right", render: (c) => <DataCell value={c.fiftyTwoWeekHigh} reason="52-week high unavailable: insufficient stored daily history" mode="money" /> },
      { id: "high52Distance", label: "% from high", align: "right", render: (c, q) => { const p = quoteFor(c, q)?.price ?? c.price; return p === undefined || !c.fiftyTwoWeekHigh ? <Missing reason="52-week high distance unavailable: price or stored 52-week high missing" /> : <span>{(((p / c.fiftyTwoWeekHigh) - 1) * 100).toFixed(2)}%</span>; } },
      { id: "low52", label: "52W low", align: "right", render: (c) => <DataCell value={c.fiftyTwoWeekLow} reason="52-week low unavailable: insufficient stored daily history" mode="money" /> },
      { id: "low52Distance", label: "% from low", align: "right", render: (c, q) => { const p = quoteFor(c, q)?.price ?? c.price; return p === undefined || !c.fiftyTwoWeekLow ? <Missing reason="52-week low distance unavailable: price or stored 52-week low missing" /> : <span>{(((p / c.fiftyTwoWeekLow) - 1) * 100).toFixed(2)}%</span>; } },
    ],
    technicals: [
      ...base,
      price,
      {
        id: "rsi",
        label: "RSI (14)",
        align: "right",
        sortBy: "rsi",
        render: (c) => {
          if (c.rsi14 === undefined) return <Missing reason="RSI(14) unavailable: awaiting daily snapshot calculation" />;
          const rsi = c.rsi14;
          const colorClass = rsi <= 30 ? "text-bull font-semibold" : rsi >= 70 ? "text-amber-400 font-semibold" : "text-foreground";
          return <span className={colorClass}>{rsi.toFixed(1)}</span>;
        },
      },
      {
        id: "sma20",
        label: "SMA 20",
        align: "right",
        sortBy: "sma20",
        render: (c) => <DataCell value={c.sma20} reason="20 SMA unavailable" mode="money" />,
      },
      {
        id: "sma50",
        label: "SMA 50",
        align: "right",
        sortBy: "sma50",
        render: (c) => <DataCell value={c.sma50} reason="50 SMA unavailable" mode="money" />,
      },
      {
        id: "sma200",
        label: "SMA 200",
        align: "right",
        sortBy: "sma200",
        render: (c) => <DataCell value={c.sma200} reason="200 SMA unavailable" mode="money" />,
      },
      {
        id: "distanceSma200",
        label: "% from 200 SMA",
        align: "right",
        sortBy: "distance_sma200",
        render: (c) => {
          if (c.distanceFromSma200Pct === undefined) return <Missing reason="Distance from 200 SMA unavailable" />;
          const val = c.distanceFromSma200Pct;
          return <span className={val >= 0 ? "text-bull" : "text-bear"}>{val >= 0 ? "+" : ""}{val.toFixed(2)}%</span>;
        },
      },
      {
        id: "distance52wHigh",
        label: "% from 52W High",
        align: "right",
        sortBy: "distance_52w_high",
        render: (c) => {
          if (c.distanceFrom52WeekHighPct === undefined) return <Missing reason="Distance from 52W High unavailable" />;
          const val = c.distanceFrom52WeekHighPct;
          return <span className={val >= 0 ? "text-bull" : "text-bear"}>{val >= 0 ? "+" : ""}{val.toFixed(2)}%</span>;
        },
      },
      {
        id: "macdHist",
        label: "MACD Hist",
        align: "right",
        render: (c) => {
          if (c.macdHistogram === undefined) return <Missing reason="MACD histogram unavailable" />;
          const val = c.macdHistogram;
          return <span className={val >= 0 ? "text-bull" : "text-bear"}>{val >= 0 ? "+" : ""}{val.toFixed(2)}</span>;
        },
      },
      {
        id: "atr",
        label: "ATR (14)",
        align: "right",
        sortBy: "atr",
        render: (c) => <DataCell value={c.atr14} reason="ATR unavailable" mode="money" />,
      },
      relVolume,
      {
        id: "trend",
        label: "52W state",
        render: (c, q) => {
          const p = quoteFor(c, q)?.price ?? c.price;
          if (p === undefined || c.fiftyTwoWeekHigh === undefined) return <Missing reason="Breakout state unavailable: price or 52-week range missing" />;
          return p >= c.fiftyTwoWeekHigh ? <span className="text-bull font-semibold">Breakout</span> : <span className="text-muted-foreground">Inside range</span>;
        },
      },
    ],
    valuation: [...base, price, marketCap,
      { id: "pe", label: "P/E", align: "right", sortBy: "pe", render: (c) => <DataCell value={c.pe} reason={reasonFor(c, "pe", "P/E unavailable: missing verified positive EPS")} /> },
      { id: "forwardPe", label: "Forward P/E", align: "right", render: (c) => <DataCell value={c.forwardPe} reason="Forward P/E unavailable from verified stored estimates" /> },
      { id: "pb", label: "P/B", align: "right", sortBy: "pb", render: (c) => <DataCell value={c.pb} reason="P/B unavailable: verified book value was not stored" /> },
      { id: "eps", label: "EPS TTM", align: "right", render: (c) => <DataCell value={c.eps} reason="EPS unavailable: no verified TTM earnings snapshot" mode="money" /> },
      { id: "book", label: "Book / share", align: "right", render: (c) => <DataCell value={c.bookValuePerShare} reason="Book value per share unavailable" mode="money" /> },
    ],
    profitability: [...base,
      { id: "roe", label: "ROE", align: "right", sortBy: "roe", render: (c) => <DataCell value={c.roe} reason="ROE unavailable: verified net income and equity were not stored" mode="percent" /> },
      { id: "roce", label: "ROCE", align: "right", sortBy: "roce", render: (c) => <DataCell value={c.roce} reason="ROCE unavailable: capital employed could not be derived" mode="percent" /> },
      { id: "roa", label: "ROA", align: "right", render: (c) => <DataCell value={c.roa} reason="ROA unavailable: net income or total assets missing" mode="percent" /> },
      { id: "opMargin", label: "Operating margin", align: "right", render: (c) => <DataCell value={c.operatingMargin} reason="Operating margin unavailable: operating income or revenue missing" mode="percent" /> },
      { id: "netMargin", label: "Net margin", align: "right", render: (c) => <DataCell value={c.netMargin} reason="Net margin unavailable: net income or revenue missing" mode="percent" /> },
    ],
    financials: [...base,
      { id: "revenue", label: "Revenue", align: "right", render: (c) => <DataCell value={c.revenue} reason="Revenue unavailable from stored normalized statements" mode="money" /> },
      { id: "netIncome", label: "Net income", align: "right", render: (c) => <DataCell value={c.netIncome} reason="Net income unavailable from stored normalized statements" mode="money" /> },
      { id: "salesGrowth", label: "Sales growth", align: "right", sortBy: "sales_growth", render: (c) => <DataCell value={c.salesGrowth} reason="Sales growth unavailable: comparable reporting periods missing" mode="percent" /> },
      { id: "profitGrowth", label: "Profit growth", align: "right", sortBy: "profit_growth", render: (c) => <DataCell value={c.profitGrowth} reason="Profit growth unavailable: comparable reporting periods missing" mode="percent" /> },
    ],
    balance: [...base, marketCap,
      { id: "de", label: "Debt / equity", align: "right", sortBy: "debt_to_equity", render: (c) => <DataCell value={c.debtToEquity} reason="Debt/equity unavailable: debt or equity missing" /> },
      { id: "currentRatio", label: "Current ratio", align: "right", sortBy: "current_ratio", render: (c) => <DataCell value={c.currentRatio} reason="Current ratio unavailable: current assets or liabilities missing" /> },
      { id: "book", label: "Book / share", align: "right", render: (c) => <DataCell value={c.bookValuePerShare} reason="Book value per share unavailable" mode="money" /> },
    ],
    dividends: [...base, price,
      { id: "dividendYield", label: "Dividend yield", align: "right", sortBy: "dividend_yield", render: (c) => <DataCell value={c.dividendYield} reason="Dividend yield unavailable from verified stored fundamentals" mode="percent" /> },
      { id: "payout", label: "Payout ratio", align: "right", render: () => <Missing reason="Payout ratio is not available in the latest stored screener snapshot" /> },
    ],
  };
  return columns[view];
}

function Screener() {
  const {
    savedScreeners,
    savedScreenersLoading,
    savedScreenersError,
    saveScreener,
    updateScreener,
    deleteScreener,
  } = useResearchWorkspace();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>({});
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [sortBy, setSortBy] = useState(DEFAULT_SCREENER_SORT.sortBy);
  const [sortDir, setSortDir] = useState(DEFAULT_SCREENER_SORT.sortDir);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [activeSavedScreenerId, setActiveSavedScreenerId] = useState<string | null>(null);
  const [savedNameDraft, setSavedNameDraft] = useState("");
  const [showSaveAsNew, setShowSaveAsNew] = useState(false);
  const [renamingSavedScreenerId, setRenamingSavedScreenerId] = useState<string | null>(null);
  const [renameSavedScreenerDraft, setRenameSavedScreenerDraft] = useState("");
  const [legacySavedViews, setLegacySavedViews] = useState<LegacySavedView[]>([]);
  const [savedAction, setSavedAction] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [sourceMode, setSourceMode] = useState("unknown");

  // The legacy browser key is read only to offer an explicit one-time account import.
  useEffect(() => setLegacySavedViews(loadLegacySavedViews()), []);
  useEffect(() => { setPage(1); }, [deferredQuery, filters, sortBy, sortDir]);

  const savedViews = useMemo<SavedScreenerView[]>(
    () => savedScreeners.map((definition) => ({
      definition,
      savedCriteria: parseSavedCriteria(definition.criteria),
    })),
    [savedScreeners],
  );
  const activeSavedView = savedViews.find(({ definition }) => definition.id === activeSavedScreenerId);
  const currentSavedCriteria = useMemo(
    () => createSavedCriteria(filters, activeView, sortBy, sortDir, hiddenColumns),
    [activeView, filters, hiddenColumns, sortBy, sortDir],
  );
  const hasUnsavedChanges = Boolean(
    activeSavedView?.savedCriteria &&
    savedCriteriaKey(activeSavedView.savedCriteria) !== savedCriteriaKey(currentSavedCriteria),
  );

  const offline = sourceMode === "nse-fallback";
  const serverQuery = useMemo<ScreenerQuery>(() => {
    const values: ScreenerQuery = { sortBy, sortDir };
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim() && !(offline && LIVE_QUOTE_FILTER_KEYS.has(key))) values[key] = value.trim();
    }
    return values;
  }, [filters, offline, sortBy, sortDir]);
  const companiesQuery = useQuery({
    queryKey: ["market-companies-v4", page, deferredQuery, serverQuery],
    queryFn: ({ signal }) => fetchMarketCompanies(page, PAGE_SIZE, deferredQuery, signal, serverQuery),
    staleTime: 30_000,
    retry: 2,
  });
  useEffect(() => {
    if (companiesQuery.data?.source) setSourceMode(companiesQuery.data.source);
  }, [companiesQuery.data?.source]);
  const companies = useMemo(() => companiesQuery.data?.items ?? [], [companiesQuery.data?.items]);
  const symbols = useMemo(() => companies.map((company) => company.symbol), [companies]);
  const quotes = useMarketQuotes(symbols);
  const visibleCompanies = useMemo(
    () => arrangeLivePage(companies, quotes.quoteMap, { filters, sort: { sortBy, sortDir }, filterLive: offline }),
    [companies, filters, offline, quotes.quoteMap, sortBy, sortDir],
  );
  const allColumns = useMemo(
    // With the database offline only identity and live-quote columns have data; the rest would be all dashes.
    () => buildColumns(activeView).filter((column) => !offline || column.offline),
    [activeView, offline],
  );
  const columns = allColumns.filter((column) => !hiddenColumns.includes(column.id));
  const availability = companiesQuery.data?.fieldAvailability ?? {};
  const hasFilter = Object.values(filters).some((value) => value.trim());
  const hasQuoteFilter = Object.entries(filters).some(([key, value]) => value.trim() && LIVE_QUOTE_FILTER_KEYS.has(key));
  const filterAvailability = (key: string) => {
    if (LIVE_QUOTE_FILTER_KEYS.has(key)) return { available: true, reason: undefined };
    const field = FILTER_AVAILABILITY_KEY[key];
    const status = field ? availability[field] : undefined;
    return {
      available: Boolean(status?.available),
      reason: status?.reason ?? "This filter requires a verified stored data field",
    };
  };

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function applyPreset(id: string) {
    const next = applyScreenerPreset(id, { sortBy, sortDir });
    setFilters(next.filters);
    setSortBy(next.sort.sortBy);
    setSortDir(next.sort.sortDir);
  }
  function changeSort(column: ScreenerColumn) {
    if (!column.sortBy) return;
    if (sortBy === column.sortBy) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(column.sortBy); setSortDir("asc"); }
  }
  async function runSavedAction(name: string, operation: () => Promise<void>) {
    setSavedAction(name);
    setSavedMessage(null);
    try {
      await operation();
    } catch (error) {
      setSavedMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "The saved-screener request failed",
      });
    } finally {
      setSavedAction(null);
    }
  }
  async function saveCurrent() {
    if (!activeSavedScreenerId) {
      setShowSaved(true);
      setShowSaveAsNew(true);
      return;
    }
    await runSavedAction("save", async () => {
      await updateScreener({
        screenerId: activeSavedScreenerId,
        criteria: currentSavedCriteria,
      });
      setSavedMessage({ kind: "success", text: "Saved view updated." });
    });
  }
  async function saveAsNew(event: FormEvent) {
    event.preventDefault();
    const name = savedNameDraft.trim();
    if (!name) return;
    await runSavedAction("save-as-new", async () => {
      const savedScreener = await saveScreener({ name, criteria: currentSavedCriteria });
      setActiveSavedScreenerId(savedScreener.id);
      setSavedNameDraft("");
      setShowSaveAsNew(false);
      setSavedMessage({ kind: "success", text: `Saved “${savedScreener.name}” to your account.` });
    });
  }
  async function renameSavedScreener(event: FormEvent, screenerId: string) {
    event.preventDefault();
    const name = renameSavedScreenerDraft.trim();
    if (!name) return;
    await runSavedAction(`rename:${screenerId}`, async () => {
      await updateScreener({ screenerId, name });
      setRenamingSavedScreenerId(null);
      setRenameSavedScreenerDraft("");
      setSavedMessage({ kind: "success", text: "Saved view renamed." });
    });
  }
  async function archiveSavedScreener(screenerId: string) {
    await runSavedAction(`delete:${screenerId}`, async () => {
      await deleteScreener(screenerId);
      if (activeSavedScreenerId === screenerId) setActiveSavedScreenerId(null);
      setSavedMessage({ kind: "success", text: "Saved view deleted." });
    });
  }
  function applySaved(view: SavedScreenerView) {
    if (!view.savedCriteria) {
      setSavedMessage({
        kind: "error",
        text: "Unsupported saved criteria: this definition cannot be applied by the current Screener.",
      });
      return;
    }
    setFilters({ ...view.savedCriteria.filters });
    setActiveView(view.savedCriteria.view);
    setSortBy(view.savedCriteria.sortBy);
    setSortDir(view.savedCriteria.sortDir);
    setHiddenColumns([...view.savedCriteria.hiddenColumns]);
    setActiveSavedScreenerId(view.definition.id);
    setSavedMessage(null);
    setShowSaved(false);
  }
  async function importLegacySavedViews() {
    if (legacySavedViews.length === 0) return;
    let importedCount = 0;
    setSavedAction("import");
    setSavedMessage(null);
    try {
      for (const legacyView of legacySavedViews) {
        await saveScreener({
          name: legacyView.name,
          criteria: createSavedCriteria(
            legacyView.filters,
            legacyView.tab,
            legacyView.sortBy,
            legacyView.sortDir,
            legacyView.hiddenColumns,
          ),
        });
        importedCount += 1;
      }
      localStorage.removeItem(SAVED_KEY);
      setLegacySavedViews([]);
      setSavedMessage({
        kind: "success",
        text: `Imported ${importedCount} local saved view${importedCount === 1 ? "" : "s"} to your account.`,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The import request failed";
      setSavedMessage({
        kind: "error",
        text: `Local import stopped after ${importedCount} of ${legacySavedViews.length}. Browser data was kept. ${reason}`,
      });
    } finally {
      setSavedAction(null);
    }
  }

  const searchMode = useMemo(() => {
    const q = deferredQuery.trim();
    if (q.length === 12 && /^[A-Z0-9]{12}$/.test(q)) return "ISIN search";
    if (q.includes(" ")) return "Company search";
    return "Symbol/name search";
  }, [deferredQuery]);
  const activePreset = useMemo(() => activeScreenerPreset(filters), [filters]);
  const filterGroups: Array<[string, ReadonlyArray<readonly [string, string]>]> = [
    ["Price & Volume", NUMERIC_FILTERS.slice(0, 8)],
    ["Valuation", NUMERIC_FILTERS.slice(8, 14)],
    ["Profitability", NUMERIC_FILTERS.slice(14, 20)],
    ["Balance Sheet & Growth", NUMERIC_FILTERS.slice(20, 24)],
    ["Technicals", NUMERIC_FILTERS.slice(24)],
  ];
  const total = companiesQuery.data?.total ?? 0;
  const resultCount = offline && hasQuoteFilter
    ? `${visibleCompanies.length} of ${companies.length} on this page`
    : `${total.toLocaleString("en-IN")} results`;
  const quoteLabel = quotes.isError
    ? "Quotes unavailable"
    : quotes.data
      ? `Quotes: ${quoteSourceLabel(quotes.data.source, quotes.delayed, quotes.marketPhase)}`
      : "Loading quotes…";
  const toolbarButton = "inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs";

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-panel/40 px-4 py-2.5 sm:px-5 sm:py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Stock Screener</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{resultCount}</span>
          {activeSavedView && (
            <span className="max-w-[12rem] truncate rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              {activeSavedView.definition.name}
            </span>
          )}
          {hasUnsavedChanges && <span className="text-[11px] text-amber-300">Unsaved changes</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void saveCurrent()}
              disabled={!activeSavedScreenerId || savedAction !== null}
              aria-label="Save"
              title="Save changes to the active saved view"
              className={`${toolbarButton} border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Check className="h-3.5 w-3.5" /><span className="hidden sm:inline">Save</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSaved(true);
                setShowSaveAsNew(true);
                setSavedNameDraft("");
              }}
              disabled={savedAction !== null}
              aria-label="Save as new"
              className={`${toolbarButton} border-border hover:bg-accent disabled:opacity-40`}
            >
              <BookmarkPlus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Save as new</span>
            </button>
            <button type="button" onClick={() => void companiesQuery.refetch()} className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent" aria-label="Refresh screener"><RefreshCw className={`h-3.5 w-3.5 ${companiesQuery.isFetching ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
        {offline && (
          <p className="mt-1 text-[11px] leading-snug text-amber-300/90">
            Database offline: NSE company list with live quotes only. Fundamentals and the other views return when it reconnects{hasQuoteFilter ? "; price, change and volume filters apply to this page" : ""}.
          </p>
        )}
      </header>

      <div className="space-y-2 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded border border-border bg-panel px-3 py-1.5 focus-within:border-primary/60">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, company name, or ISIN" className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none" aria-label="Search symbol company name or ISIN" />
            {query.trim() && <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{searchMode}</span>}
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
          </label>
          <button type="button" onClick={() => setShowAdvanced((current) => !current)} className={`${toolbarButton} py-2 ${showAdvanced ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}><SlidersHorizontal className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Advanced filters</span></button>
          <button type="button" onClick={() => setShowColumns((current) => !current)} className={`${toolbarButton} py-2 ${showColumns ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}><Eye className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Columns</span></button>
          <button type="button" onClick={() => setShowSaved((current) => !current)} className={`${toolbarButton} py-2 ${showSaved ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}><Bookmark className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Saved</span> <span className="rounded bg-accent px-1 font-mono text-[10px]">{savedViews.length}</span></button>
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
          {SCREENER_PRESETS.map((preset) => {
            const enabled = (preset.requires ?? []).every((field) => availability[field]?.available);
            return (
              <button
                key={preset.id}
                type="button"
                disabled={!enabled}
                onClick={() => applyPreset(preset.id)}
                aria-pressed={activePreset === preset.id}
                title={enabled ? preset.title : `${preset.title}. Needs stored data that is unavailable right now.`}
                className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${activePreset === preset.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-panel text-foreground"}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {showAdvanced && <div className="border-b border-border bg-panel/70 px-5 py-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filterGroups.map(([title, fields]) => <fieldset key={title} className="rounded-lg border border-border bg-background/60 p-3"><legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</legend>
            <div className="grid grid-cols-2 gap-2">{fields.map(([key, label]) => { const status = filterAvailability(key); return <label key={key} className={`text-[10px] text-muted-foreground ${status.available ? "" : "opacity-45"}`} title={status.reason}>{label}<input value={filters[key] ?? ""} disabled={!status.available} onChange={(event) => updateFilter(key, event.target.value)} inputMode="decimal" className="mt-1 w-full rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50 disabled:cursor-not-allowed" /></label>; })}</div></fieldset>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><label className={`text-xs text-muted-foreground ${availability.marketCap?.available ? "" : "opacity-45"}`} title={availability.marketCap?.reason}>Cap bucket <select value={filters.bucket_in ?? ""} disabled={!availability.marketCap?.available} onChange={(event) => updateFilter("bucket_in", event.target.value)} className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground disabled:cursor-not-allowed"><option value="">Any</option><option value="large">Large</option><option value="mid">Mid</option><option value="small">Small</option><option value="unknown">Unknown</option></select></label>
          <label className={`text-xs text-muted-foreground ${availability.sector?.available ? "" : "opacity-45"}`} title={availability.sector?.reason}>Sector <input value={filters.sector_in ?? ""} disabled={!availability.sector?.available} onChange={(event) => updateFilter("sector_in", event.target.value)} placeholder="e.g. Technology" className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground outline-none disabled:cursor-not-allowed" /></label>
          <label className={`text-xs text-muted-foreground ${availability.industry?.available ? "" : "opacity-45"}`} title={availability.industry?.reason}>Industry <input value={filters.industry_in ?? ""} disabled={!availability.industry?.available} onChange={(event) => updateFilter("industry_in", event.target.value)} placeholder="e.g. Software" className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground outline-none disabled:cursor-not-allowed" /></label>
          <label className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${availability.fiftyTwoWeekHigh?.available ? "" : "opacity-45"}`} title={availability.fiftyTwoWeekHigh?.reason}><input type="checkbox" disabled={!availability.fiftyTwoWeekHigh?.available} checked={filters.fifty_two_week_high_breakout === "true"} onChange={(event) => updateFilter("fifty_two_week_high_breakout", event.target.checked ? "true" : "")} />52W breakout</label>
          <label className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${availability.fiftyTwoWeekLow?.available ? "" : "opacity-45"}`} title={availability.fiftyTwoWeekLow?.reason}><input type="checkbox" disabled={!availability.fiftyTwoWeekLow?.available} checked={filters.fifty_two_week_low_near === "true"} onChange={(event) => updateFilter("fifty_two_week_low_near", event.target.checked ? "true" : "")} />Near 52W low</label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.price_above_sma200 === "true"} onChange={(event) => updateFilter("price_above_sma200", event.target.checked ? "true" : "")} />&gt; 200 SMA</label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.golden_cross === "true"} onChange={(event) => updateFilter("golden_cross", event.target.checked ? "true" : "")} />Golden Cross</label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.rsi_oversold === "true"} onChange={(event) => updateFilter("rsi_oversold", event.target.checked ? "true" : "")} />RSI &le; 30</label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.rsi_overbought === "true"} onChange={(event) => updateFilter("rsi_overbought", event.target.checked ? "true" : "")} />RSI &ge; 70</label>
          <button type="button" onClick={() => setFilters({})} className="ml-auto rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Reset all</button></div>
      </div>}

      {showSaved && (
        <div className="border-b border-border bg-panel px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              Saved screeners
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Account backed</span>
            </div>
            {legacySavedViews.length > 0 && (
              <button
                type="button"
                onClick={() => void importLegacySavedViews()}
                disabled={savedAction !== null}
                className="rounded border border-amber-500/30 px-2.5 py-1.5 text-[11px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              >
                Import local saved views ({legacySavedViews.length})
              </button>
            )}
          </div>

          {savedMessage && (
            <div
              role="status"
              className={`mt-2 rounded border px-3 py-2 text-xs ${
                savedMessage.kind === "error"
                  ? "border-bear/30 bg-bear/10 text-bear"
                  : "border-bull/30 bg-bull/10 text-bull"
              }`}
            >
              {savedMessage.text}
            </div>
          )}

          {showSaveAsNew && (
            <form onSubmit={saveAsNew} className="mt-3 flex flex-col gap-2 rounded border border-border bg-background p-3 sm:flex-row">
              <input
                value={savedNameDraft}
                onChange={(event) => setSavedNameDraft(event.target.value)}
                placeholder="Saved view name"
                maxLength={80}
                autoFocus
                className="min-w-0 flex-1 rounded border border-border bg-panel px-3 py-1.5 text-xs outline-none focus:border-primary/60"
              />
              <button type="submit" disabled={!savedNameDraft.trim() || savedAction !== null} className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40">
                Save as new
              </button>
              <button type="button" onClick={() => setShowSaveAsNew(false)} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-accent">
                Cancel
              </button>
            </form>
          )}

          {savedScreenersError ? (
            <p className="mt-3 text-xs text-bear">
              Saved views unavailable: {savedScreenersError instanceof Error ? savedScreenersError.message : "account storage could not be reached"}
            </p>
          ) : savedScreenersLoading ? (
            <p className="mt-3 text-xs text-muted-foreground">Loading account saved views…</p>
          ) : savedViews.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No account saved views. Save the current filters, view, sort, and visible columns as a new definition.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {savedViews.map((view) => {
                const { definition, savedCriteria } = view;
                const isActive = definition.id === activeSavedScreenerId;
                return (
                  <div key={definition.id} className={`rounded border bg-background p-2 ${isActive ? "border-primary/50" : "border-border"}`}>
                    {renamingSavedScreenerId === definition.id ? (
                      <form onSubmit={(event) => renameSavedScreener(event, definition.id)} className="flex items-center gap-2">
                        <input
                          value={renameSavedScreenerDraft}
                          onChange={(event) => setRenameSavedScreenerDraft(event.target.value)}
                          maxLength={80}
                          autoFocus
                          className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 text-xs outline-none focus:border-primary/60"
                        />
                        <button type="submit" disabled={!renameSavedScreenerDraft.trim() || savedAction !== null} className="rounded border border-border p-1 text-primary disabled:opacity-40" aria-label={`Save name for ${definition.name}`}>
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setRenamingSavedScreenerId(null)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label={`Cancel rename for ${definition.name}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{definition.name}</span>
                          {isActive && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Active</span>}
                          {!savedCriteria && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Unsupported saved criteria</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => applySaved(view)}
                            disabled={!savedCriteria || savedAction !== null}
                            className="rounded border border-border px-2 py-1 text-[11px] hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSavedScreenerId(definition.id);
                              setRenameSavedScreenerDraft(definition.name);
                            }}
                            disabled={savedAction !== null}
                            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => void archiveSavedScreener(definition.id)}
                            disabled={savedAction !== null}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-bear disabled:opacity-40"
                          >
                            <Trash2 className="h-3 w-3" />Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showColumns && <div className="border-b border-border bg-panel px-5 py-3"><div className="flex flex-wrap gap-2">{allColumns.filter((column) => !["rank", "company"].includes(column.id)).map((column) => { const hidden = hiddenColumns.includes(column.id); return <button key={column.id} type="button" onClick={() => setHiddenColumns((current) => hidden ? current.filter((id) => id !== column.id) : [...current, column.id])} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${hidden ? "border-border text-muted-foreground" : "border-primary/40 text-foreground"}`}>{hidden ? <EyeOff className="h-3 w-3" /> : <Check className="h-3 w-3" />}{column.label}</button>; })}</div></div>}

      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-4">
        {TABS.map((tab) => {
          // Only the overview has identity and live-quote columns to show while the database is offline.
          const unavailable = offline && tab.id !== "overview";
          return (
            <button
              key={tab.id}
              type="button"
              disabled={unavailable}
              title={unavailable ? "Needs the database, which is offline" : undefined}
              onClick={() => setActiveView(tab.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${activeView === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground enabled:hover:text-foreground"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-background">
            <tr>
              {columns.map((column) => (
                <th key={column.id} className={`whitespace-nowrap border-b border-border px-3 py-2 font-medium text-muted-foreground ${column.align === "right" ? "text-right" : "text-left"} ${column.cellClass ?? ""}`}>
                  <button type="button" disabled={!column.sortBy} onClick={() => changeSort(column)} className="inline-flex items-center gap-1 disabled:cursor-default">
                    {column.label}
                    {column.sortBy && <ChevronDown className={`h-3 w-3 ${sortBy === column.sortBy ? "text-primary" : "opacity-30"} ${sortBy === column.sortBy && sortDir === "asc" ? "rotate-180" : ""}`} />}
                  </button>
                </th>
              ))}
              <th className="border-b border-border px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleCompanies.map((company, index) => (
              <ScreenerRow
                key={company.symbol}
                company={company}
                rank={(page - 1) * PAGE_SIZE + index + 1}
                columns={columns}
                quotes={quotes.quoteMap}
                screenerRunId={activePreset ?? "custom"}
              />
            ))}
            {companiesQuery.isFetching && companies.length === 0 && Array.from({ length: 8 }, (_, index) => <tr key={index}>{columns.map((column) => <td key={column.id} className={`border-b border-border/40 px-3 py-3 ${column.cellClass ?? ""}`}><div className="h-4 animate-pulse rounded bg-accent" /></td>)}<td /></tr>)}
            {!companiesQuery.isFetching && visibleCompanies.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-6 py-16 text-center">
                  <div className="text-sm font-medium">
                    {companiesQuery.isError ? "Screener API unavailable" : deferredQuery ? `No companies found for '${deferredQuery}'` : "No companies match these filters"}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {companiesQuery.isError
                      ? (companiesQuery.error instanceof Error ? companiesQuery.error.message : "Try again shortly")
                      : deferredQuery
                        ? "Check spelling or try a different symbol/name/ISIN."
                        : companiesQuery.data?.source === "nse-fallback" && hasFilter
                          ? hasQuoteFilter
                            ? "No companies on this live page match the price, change, or volume filter. Stored fundamental filters require PostgreSQL snapshots."
                            : "These filters require stored database snapshots; the NSE identity fallback cannot evaluate them honestly."
                          : "Try widening the criteria or clearing filters."
                    }
                  </p>
                  {deferredQuery && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-1">Try these common symbols:</p>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {["RELIANCE", "HDFCBANK", "TCS", "INFY", "NESTLEIND"].map(symbol => (
                          <button
                            key={symbol}
                            type="button"
                            onClick={() => setQuery(symbol)}
                            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent hover:text-primary font-mono"
                          >
                            {symbol}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasFilter && !deferredQuery && (
                    <button type="button" onClick={() => setFilters({})} className="mt-3 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent">Clear filters</button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><i className={`h-1.5 w-1.5 rounded-full ${quotes.isError ? "bg-bear" : quotes.delayed ? "bg-amber-400" : "bg-bull"}`} />{quoteLabel}</span>
          {companiesQuery.data?.generatedAt && <span className="hidden sm:inline">Updated {new Date(companiesQuery.data.generatedAt).toLocaleTimeString("en-IN")}</span>}
        </div>
        <div className="flex items-center gap-2 font-mono"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span>Page {page} / {Math.max(1, companiesQuery.data?.pageCount ?? 1)}</span><button type="button" disabled={page >= (companiesQuery.data?.pageCount ?? 1)} onClick={() => setPage((current) => current + 1)} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></footer>
    </div>
  );
}
