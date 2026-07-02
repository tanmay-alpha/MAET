import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink,
  Eye, EyeOff, MoreHorizontal, RefreshCw, Search, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketCompanies, type MarketCompany, type ScreenerQuery } from "@/lib/market-api";
import { getTradingViewUrl } from "@/lib/tradingview";

export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type ViewId = "overview" | "performance" | "technicals" | "valuation" | "profitability" | "financials" | "balance" | "dividends";
type FilterState = Record<string, string>;
type SavedView = {
  id: string;
  name: string;
  filters: FilterState;
  tab: ViewId;
  sortBy: string;
  sortDir: "asc" | "desc";
  hiddenColumns: string[];
  updatedAt: string;
};
type Column = {
  id: string;
  label: string;
  align?: "left" | "right";
  sortBy?: string;
  render: (company: MarketCompany, live: ReturnType<typeof useMarketQuotes>["quoteMap"]) => ReactNode;
};

const PAGE_SIZE = 50;
const SAVED_KEY = "maet:screener-v4:views";
const NUMERIC_FILTERS = [
  ["price_min", "Min price"], ["price_max", "Max price"], ["change_pct_min", "Min change %"], ["change_pct_max", "Max change %"],
  ["volume_min", "Min volume"], ["volume_max", "Max volume"], ["rel_volume_min", "Min rel volume"], ["rel_volume_max", "Max rel volume"],
  ["market_cap_min", "Min market cap"], ["market_cap_max", "Max market cap"],
  ["pe_min", "Min P/E"], ["pe_max", "Max P/E"], ["pb_min", "Min P/B"], ["pb_max", "Max P/B"],
  ["roe_min", "Min ROE"], ["roe_max", "Max ROE"], ["roce_min", "Min ROCE"], ["roce_max", "Max ROCE"],
  ["dividend_yield_min", "Min dividend yield"], ["dividend_yield_max", "Max dividend yield"],
  ["debt_to_equity_max", "Max debt / equity"], ["current_ratio_min", "Min current ratio"],
  ["sales_growth_min", "Min sales growth"], ["profit_growth_min", "Min profit growth"],
] as const;

const TABS: Array<{ id: ViewId; label: string }> = [
  { id: "overview", label: "Overview" }, { id: "performance", label: "Performance" }, { id: "technicals", label: "Technicals" },
  { id: "valuation", label: "Valuation" }, { id: "profitability", label: "Profitability" }, { id: "financials", label: "Financials" },
  { id: "balance", label: "Balance Sheet" }, { id: "dividends", label: "Dividends" },
];

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as SavedView[]; } catch { return []; }
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
  if (value === undefined) return "—";
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(2)}%`;
}

function Missing({ reason }: { reason: string }) {
  return <span className="cursor-help select-none text-muted-foreground" title={reason}>—</span>;
}

function DataCell({ value, reason, mode = "number" }: { value?: number; reason: string; mode?: "number" | "money" | "percent" }) {
  if (value === undefined) return <Missing reason={reason} />;
  return <span>{mode === "money" ? money(value) : mode === "percent" ? percent(value) : numberValue(value)}</span>;
}

function quoteFor(company: MarketCompany, quotes: ReturnType<typeof useMarketQuotes>["quoteMap"]) {
  return quotes.get(company.symbol);
}

function reasonFor(company: MarketCompany, field: string, fallback: string): string {
  if (company.staleFundamentals) return `${fallback}. The latest stored fundamentals snapshot is stale.`;
  return fallback;
}

function buildColumns(view: ViewId): Column[] {
  const price: Column = { id: "price", label: "Price", align: "right", sortBy: "price", render: (c, q) => <DataCell value={quoteFor(c, q)?.price ?? c.price} reason="Price unavailable: no persisted or reachable quote snapshot" mode="money" /> };
  const change: Column = { id: "changePct", label: "Chg %", align: "right", sortBy: "change_pct", render: (c, q) => { const value = quoteFor(c, q)?.changePct ?? c.changePct; return value === undefined ? <Missing reason="Change unavailable: previous close was not supplied by the verified quote source" /> : <span className={value >= 0 ? "text-bull" : "text-bear"}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</span>; } };
  const volume: Column = { id: "volume", label: "Volume", align: "right", sortBy: "volume", render: (c, q) => <DataCell value={quoteFor(c, q)?.volume ?? c.volume} reason="Volume unavailable from the latest verified quote snapshot" /> };
  const marketCap: Column = { id: "marketCap", label: "Market cap", align: "right", sortBy: "market_cap", render: (c) => <DataCell value={c.marketCap} reason="Market cap unavailable: no verified stored fundamentals value" mode="money" /> };
  const relVolume: Column = { id: "relVolume", label: "Rel volume", align: "right", sortBy: "rel_volume", render: (c) => <DataCell value={c.relVolume} reason="Relative volume unavailable: 20-day average volume not yet computed" /> };
  const base: Column[] = [
    { id: "rank", label: "#", render: () => null },
    { id: "company", label: "Company", sortBy: "symbol", render: () => null },
  ];
  const columns: Record<ViewId, Column[]> = {
    overview: [...base, price, change, volume, marketCap,
      { id: "sector", label: "Sector", sortBy: "sector", render: (c) => c.sector ?? <Missing reason="Sector unavailable from the verified NSE/company snapshot" /> },
      { id: "isin", label: "ISIN", render: (c) => c.isin || <Missing reason="ISIN missing from the NSE company master" /> },
    ],
    performance: [...base, price, change, volume, relVolume,
      { id: "high52", label: "52W high", align: "right", render: (c) => <DataCell value={c.fiftyTwoWeekHigh} reason="52-week high unavailable: insufficient stored daily history" mode="money" /> },
      { id: "low52", label: "52W low", align: "right", render: (c) => <DataCell value={c.fiftyTwoWeekLow} reason="52-week low unavailable: insufficient stored daily history" mode="money" /> },
    ],
    technicals: [...base, price, relVolume,
      { id: "avg20", label: "Avg 20D volume", align: "right", render: (c) => <DataCell value={c.average20DayVolume} reason="20-day average volume has not been computed" /> },
      { id: "trend", label: "52W state", render: (c, q) => { const p = quoteFor(c, q)?.price ?? c.price; if (p === undefined || c.fiftyTwoWeekHigh === undefined) return <Missing reason="Breakout state unavailable: price or 52-week range missing" />; return p >= c.fiftyTwoWeekHigh ? <span className="text-bull">Breakout</span> : <span className="text-muted-foreground">Inside range</span>; } },
      { id: "rsi", label: "RSI", align: "right", render: () => <Missing reason="RSI is calculated on the chart; no current RSI snapshot is persisted for screener sorting" /> },
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
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>({});
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [sortBy, setSortBy] = useState("symbol");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  useEffect(() => setSavedViews(loadSavedViews()), []);
  useEffect(() => { setPage(1); }, [deferredQuery, filters, sortBy, sortDir]);

  const serverQuery = useMemo<ScreenerQuery>(() => {
    const values: ScreenerQuery = { sortBy, sortDir };
    for (const [key, value] of Object.entries(filters)) if (value.trim()) values[key] = value.trim();
    return values;
  }, [filters, sortBy, sortDir]);
  const companiesQuery = useQuery({
    queryKey: ["market-companies-v4", page, deferredQuery, serverQuery],
    queryFn: ({ signal }) => fetchMarketCompanies(page, PAGE_SIZE, deferredQuery, signal, serverQuery),
    staleTime: 30_000,
    retry: 2,
  });
  const companies = useMemo(() => companiesQuery.data?.items ?? [], [companiesQuery.data?.items]);
  const symbols = useMemo(() => companies.map((company) => company.symbol), [companies]);
  const quotes = useMarketQuotes(symbols);
  const allColumns = useMemo(() => buildColumns(activeView), [activeView]);
  const columns = allColumns.filter((column) => !hiddenColumns.includes(column.id));
  const availability = companiesQuery.data?.fieldAvailability ?? {};
  const hasFilter = Object.values(filters).some(Boolean);

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function applyPreset(id: string) {
    const next: FilterState = {};
    if (id === "gainers") next.change_pct_min = "0.01";
    if (id === "losers") next.change_pct_max = "-0.01";
    if (id === "high-volume") next.volume_min = "1000000";
    if (id === "price-1000") next.price_min = "1000";
    if (id === "active") next.change_pct_min = "1";
    if (["large", "mid", "small"].includes(id)) next.bucket_in = id;
    if (id === "value") { next.pe_max = "20"; next.pb_max = "3"; }
    if (id === "roe") next.roe_min = "15";
    if (id === "dividend") next.dividend_yield_min = "0.01";
    setFilters(next);
  }
  function changeSort(column: Column) {
    if (!column.sortBy) return;
    if (sortBy === column.sortBy) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(column.sortBy); setSortDir("asc"); }
  }
  function persistSaved(next: SavedView[]) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSavedViews(next);
  }
  function saveCurrent() {
    const name = window.prompt("Name this screener view");
    if (!name?.trim()) return;
    const now = new Date().toISOString();
    persistSaved([...savedViews, { id: crypto.randomUUID(), name: name.trim(), filters, tab: activeView, sortBy, sortDir, hiddenColumns, updatedAt: now }]);
    setShowSaved(true);
  }
  function applySaved(view: SavedView) {
    setFilters(view.filters); setActiveView(view.tab); setSortBy(view.sortBy); setSortDir(view.sortDir); setHiddenColumns(view.hiddenColumns); setShowSaved(false);
  }

  const presets = [
    ["all", "All stocks", true], ["gainers", "Gainers", true], ["losers", "Losers", true], ["high-volume", "High volume", true],
    ["price-1000", "Price above 1000", true], ["active", "Active movers", true],
    ["large", "Large cap", Boolean(availability.marketCap?.available)], ["mid", "Mid cap", Boolean(availability.marketCap?.available)], ["small", "Small cap", Boolean(availability.marketCap?.available)],
    ["value", "Deep value", Boolean(availability.pe?.available && availability.pb?.available)], ["roe", "High ROE", Boolean(availability.roe?.available)],
    ["dividend", "High dividend", Boolean(availability.dividendYield?.available)],
  ] as const;
  const filterGroups: Array<[string, ReadonlyArray<readonly [string, string]>]> = [
    ["Price & Volume", NUMERIC_FILTERS.slice(0, 8)],
    ["Valuation", NUMERIC_FILTERS.slice(8, 14)],
    ["Profitability", NUMERIC_FILTERS.slice(14, 20)],
    ["Balance Sheet & Growth", NUMERIC_FILTERS.slice(20)],
  ];

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-panel/40 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Stock Screener</h1><span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-[10px] text-primary">NSE</span></div>
            <p className="mt-1 text-xs text-muted-foreground">Database-first Indian equity scanner · live broker quotes where connected · delayed Yahoo history</p></div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border border-border bg-background px-2 py-1"><strong>{companiesQuery.data?.total.toLocaleString("en-IN") ?? "—"}</strong> results</span>
            <span className="rounded border border-border bg-background px-2 py-1 text-muted-foreground">Universe {companiesQuery.data?.universeTotal.toLocaleString("en-IN") ?? "—"}</span>
            <span className="rounded border border-border bg-background px-2 py-1 text-muted-foreground">Updated {companiesQuery.data?.generatedAt ? new Date(companiesQuery.data.generatedAt).toLocaleTimeString("en-IN") : "—"}</span>
            <button type="button" onClick={saveCurrent} className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 hover:bg-accent"><BookmarkPlus className="h-3.5 w-3.5" />Save</button>
            <button type="button" onClick={() => void companiesQuery.refetch()} className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent" aria-label="Refresh screener"><RefreshCw className={`h-4 w-4 ${companiesQuery.isFetching ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-blue-400" />DB stored</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-bull" />Angel live</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-400" />Yahoo delayed</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />— unavailable</span>
          <span className="ml-auto">{companiesQuery.data?.sourceSummary.join(" · ")}</span>
        </div>
      </header>

      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded border border-border bg-panel px-3 py-2 focus-within:border-primary/60"><Search className="h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, company name, or ISIN" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Search symbol company name or ISIN" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
          </label>
          <button type="button" onClick={() => setShowAdvanced((current) => !current)} className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-xs ${showAdvanced ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}><SlidersHorizontal className="h-3.5 w-3.5" />Advanced filters</button>
          <button type="button" onClick={() => setShowColumns((current) => !current)} className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs hover:bg-accent"><Eye className="h-3.5 w-3.5" />Columns</button>
          <button type="button" onClick={() => setShowSaved((current) => !current)} className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs hover:bg-accent">Saved <span className="rounded bg-accent px-1">{savedViews.length}</span></button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">{presets.map(([id, label, enabled]) => <button key={id} type="button" disabled={!enabled} onClick={() => applyPreset(id)} title={enabled ? undefined : "Requires verified stored data for this field"} className="whitespace-nowrap rounded-full border border-border bg-panel px-2.5 py-1 text-[11px] hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-35">{label}</button>)}</div>
      </div>

      {showAdvanced && <div className="border-b border-border bg-panel/70 px-5 py-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filterGroups.map(([title, fields]) => <fieldset key={title} className="rounded-lg border border-border bg-background/60 p-3"><legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</legend>
            <div className="grid grid-cols-2 gap-2">{fields.map(([key, label]) => <label key={key} className="text-[10px] text-muted-foreground">{label}<input value={filters[key] ?? ""} onChange={(event) => updateFilter(key, event.target.value)} inputMode="decimal" className="mt-1 w-full rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50" /></label>)}</div></fieldset>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-xs text-muted-foreground">Cap bucket <select value={filters.bucket_in ?? ""} onChange={(event) => updateFilter("bucket_in", event.target.value)} className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground"><option value="">Any</option><option value="large">Large</option><option value="mid">Mid</option><option value="small">Small</option><option value="unknown">Unknown</option></select></label>
          <label className="text-xs text-muted-foreground">Sector <input value={filters.sector_in ?? ""} onChange={(event) => updateFilter("sector_in", event.target.value)} placeholder="e.g. Technology" className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground outline-none" /></label>
          <label className="text-xs text-muted-foreground">Industry <input value={filters.industry_in ?? ""} onChange={(event) => updateFilter("industry_in", event.target.value)} placeholder="e.g. Software" className="ml-2 rounded border border-border bg-panel px-2 py-1.5 text-foreground outline-none" /></label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.fifty_two_week_high_breakout === "true"} onChange={(event) => updateFilter("fifty_two_week_high_breakout", event.target.checked ? "true" : "")} />52W breakout</label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.fifty_two_week_low_near === "true"} onChange={(event) => updateFilter("fifty_two_week_low_near", event.target.checked ? "true" : "")} />Near 52W low</label>
          <button type="button" onClick={() => setFilters({})} className="ml-auto rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Reset all</button></div>
      </div>}

      {showSaved && <div className="border-b border-border bg-panel px-5 py-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold">Saved screeners <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Local only</span></div>
        {savedViews.length === 0 ? <p className="text-xs text-muted-foreground">Save the current filters, tab, sort, and visible columns to this browser.</p> : <div className="flex flex-wrap gap-2">{savedViews.map((view) => <div key={view.id} className="flex items-center rounded border border-border bg-background"><button type="button" onClick={() => applySaved(view)} className="px-3 py-1.5 text-xs hover:text-primary">{view.name}</button><button type="button" onClick={() => { const name = window.prompt("Rename screener", view.name); if (name?.trim()) persistSaved(savedViews.map((item) => item.id === view.id ? { ...item, name: name.trim(), updatedAt: new Date().toISOString() } : item)); }} className="border-l border-border p-1.5 text-muted-foreground" title="Rename"><MoreHorizontal className="h-3 w-3" /></button><button type="button" onClick={() => persistSaved(savedViews.filter((item) => item.id !== view.id))} className="border-l border-border p-1.5 text-muted-foreground hover:text-bear" title="Delete"><Trash2 className="h-3 w-3" /></button></div>)}</div>}
      </div>}

      {showColumns && <div className="border-b border-border bg-panel px-5 py-3"><div className="flex flex-wrap gap-2">{allColumns.filter((column) => !["rank", "company"].includes(column.id)).map((column) => { const hidden = hiddenColumns.includes(column.id); return <button key={column.id} type="button" onClick={() => setHiddenColumns((current) => hidden ? current.filter((id) => id !== column.id) : [...current, column.id])} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${hidden ? "border-border text-muted-foreground" : "border-primary/40 text-foreground"}`}>{hidden ? <EyeOff className="h-3 w-3" /> : <Check className="h-3 w-3" />}{column.label}</button>; })}</div></div>}

      <div className="flex gap-1 overflow-x-auto border-b border-border px-4">{TABS.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveView(tab.id)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium ${activeView === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}</div>

      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-background/95 backdrop-blur"><tr>{columns.map((column) => <th key={column.id} className={`border-b border-border px-3 py-2.5 font-medium text-muted-foreground ${column.align === "right" ? "text-right" : "text-left"}`}><button type="button" disabled={!column.sortBy} onClick={() => changeSort(column)} className="inline-flex items-center gap-1 disabled:cursor-default">{column.label}{column.sortBy && <ChevronDown className={`h-3 w-3 ${sortBy === column.sortBy ? "text-primary" : "opacity-30"} ${sortBy === column.sortBy && sortDir === "asc" ? "rotate-180" : ""}`} />}</button></th>)}<th className="border-b border-border px-3 py-2.5 text-right text-muted-foreground">Actions</th></tr></thead>
          <tbody>{companies.map((company, index) => <tr key={company.symbol} className="group border-b border-border/50 hover:bg-accent/35">
            {columns.map((column) => <td key={column.id} className={`border-b border-border/40 px-3 py-2.5 font-mono tabular-nums ${column.align === "right" ? "text-right" : "text-left"}`}>{column.id === "rank" ? <span className="text-muted-foreground">{(page - 1) * PAGE_SIZE + index + 1}</span> : column.id === "company" ? <button type="button" onClick={() => navigate({ to: `/stock/${company.symbol}` })} className="flex min-w-[240px] items-center gap-2 text-left"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">{company.symbol[0]}</span><span><span className="block font-semibold text-primary">{company.symbol}</span><span className="block max-w-[210px] truncate font-sans text-[11px] text-foreground/80">{company.name}</span></span>{company.marketCapBucket !== "unknown" && <span className="rounded bg-accent px-1 py-0.5 text-[9px] uppercase text-muted-foreground">{company.marketCapBucket}</span>}</button> : column.render(company, quotes.quoteMap)}</td>)}
            <td className="border-b border-border/40 px-3 py-2.5"><div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100"><button type="button" onClick={() => navigate({ to: `/stock/${company.symbol}` })} className="rounded p-1.5 hover:bg-accent" title="Open company detail"><Building2Icon /></button><button type="button" onClick={() => navigate({ to: `/chart/${company.symbol}` })} className="rounded p-1.5 hover:bg-accent" title="Open chart"><BarChart3 className="h-3.5 w-3.5" /></button><a href={getTradingViewUrl(company.symbol)} target="_blank" rel="noreferrer" className="rounded p-1.5 hover:bg-accent" title="Open TradingView"><ExternalLink className="h-3.5 w-3.5" /></a><button type="button" onClick={() => void navigator.clipboard.writeText(company.symbol)} className="rounded p-1.5 hover:bg-accent" title="Copy symbol"><Copy className="h-3.5 w-3.5" /></button></div></td>
          </tr>)}
            {companiesQuery.isFetching && companies.length === 0 && Array.from({ length: 8 }, (_, index) => <tr key={index}>{columns.map((column) => <td key={column.id} className="border-b border-border/40 px-3 py-3"><div className="h-4 animate-pulse rounded bg-accent" /></td>)}<td /></tr>)}
            {!companiesQuery.isFetching && companies.length === 0 && <tr><td colSpan={columns.length + 1} className="px-6 py-16 text-center"><div className="text-sm font-medium">{companiesQuery.isError ? "Screener API unavailable" : "No companies match these filters"}</div><p className="mt-2 text-xs text-muted-foreground">{companiesQuery.isError ? (companiesQuery.error instanceof Error ? companiesQuery.error.message : "Try again shortly") : companiesQuery.data?.source === "nse-fallback" && hasFilter ? "These filters require stored database snapshots; the NSE identity fallback cannot evaluate them honestly." : "Try clearing filters or searching another symbol, company, or ISIN."}</p>{hasFilter && <button type="button" onClick={() => setFilters({})} className="mt-3 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent">Clear filters</button>}</td></tr>}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-panel px-4 py-2 text-[11px] text-muted-foreground"><div className="flex items-center gap-4"><span className="inline-flex items-center gap-1.5"><i className={`h-1.5 w-1.5 rounded-full ${quotes.isError ? "bg-bear" : quotes.streamConnected ? "bg-bull animate-pulse" : "bg-amber-400"}`} />{quotes.isError ? "Quote service unavailable" : quotes.streamConnected ? "Broker stream connected" : "Delayed quote polling"}</span><span>{companies.length} rows · source {companiesQuery.data?.source ?? "loading"}</span></div>
        <div className="flex items-center gap-2 font-mono"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span>Page {page} / {Math.max(1, companiesQuery.data?.pageCount ?? 1)}</span><button type="button" disabled={page >= (companiesQuery.data?.pageCount ?? 1)} onClick={() => setPage((current) => current + 1)} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></footer>
    </div>
  );
}

function Building2Icon() {
  return <span className="text-[11px] font-semibold">↗</span>;
}
