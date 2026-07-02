import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BarChart3, BookmarkPlus, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, Table } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketCompanies, type MarketCompany, type MarketQuote } from "@/lib/market-api";
import { SavedScreeners, type SavedScreener, type FilterCondition } from "@/components/screener/saved-screeners";

export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type Row = {
  symbol: string;
  name: string;
  logo: string;
  logoColor: string;
  isin: string;
};

const LOGO_COLORS = ["bg-blue-700", "bg-cyan-700", "bg-emerald-700", "bg-amber-700", "bg-orange-700", "bg-rose-700", "bg-indigo-700", "bg-slate-700"];
const PAGE_SIZE = 25;

function companyRow(company: MarketCompany): Row {
  const colorIndex = [...company.symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0) % LOGO_COLORS.length;
  return {
    symbol: company.symbol,
    name: company.name,
    logo: company.symbol.charAt(0),
    logoColor: LOGO_COLORS[colorIndex],
    isin: company.isin,
  };
}

function matchesFilter(quote: MarketQuote | undefined, filter: FilterCondition): boolean {
  if (!quote) return false;
  const value = filter.field === "price"
    ? quote.price
    : filter.field === "volume"
      ? quote.volume
      : filter.field === "changePct"
        ? quote.changePct
        : undefined;
  const target = Number(filter.value);
  if (value === undefined || !Number.isFinite(target)) return false;

  switch (filter.operator) {
    case "gt": return value > target;
    case "gte": return value >= target;
    case "lt": return value < target;
    case "lte": return value <= target;
    case "eq": return value === target;
    case "between": {
      const upper = Number(filter.value2);
      return Number.isFinite(upper) && value >= target && value <= upper;
    }
    default: return false;
  }
}

function LivePriceCell({ price }: { price?: number }) {
  return (
    <span className="inline-block rounded-sm px-1 font-mono tabular">
      {price?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
      {price !== undefined && <span className="ml-1 text-[10px] text-muted-foreground">INR</span>}
    </span>
  );
}

function Screener() {
  const [selected, setSelected] = useState<string | null>("RELIANCE");
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [showSaved, setShowSaved] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [minChange, setMinChange] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [activeView, setActiveView] = useState<"overview" | "performance" | "technicals">("overview");
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const companiesQuery = useQuery({
    queryKey: ["market-companies", page, deferredQuery],
    queryFn: ({ signal }) => fetchMarketCompanies(page, PAGE_SIZE, deferredQuery, signal),
    staleTime: 60 * 60 * 1_000,
    retry: 2,
  });
  const companyRows = useMemo(() => (companiesQuery.data?.items ?? []).map(companyRow), [companiesQuery.data?.items]);
  const screenerSymbols = useMemo(() => companyRows.map((row) => row.symbol), [companyRows]);
  const { quoteMap, streamConnected, isError: quoteError, isFetching: quotesFetching, refetch } = useMarketQuotes(screenerSymbols);

  // Apply filters to rows
  const filteredRows = useMemo(() => {
    let result = companyRows;

    if (activeFilters.length > 0) {
      result = result.filter((row) => activeFilters.every((filter) =>
        matchesFilter(quoteMap.get(row.symbol), filter)
      ));
    }

    const priceFloor = Number(minPrice);
    const changeFloor = Number(minChange);
    const volumeFloor = Number(minVolume);
    result = result.filter((row) => {
      const quote = quoteMap.get(row.symbol);
      if (minPrice && (!quote || quote.price < priceFloor)) return false;
      if (minChange && (!quote || (quote.changePct ?? Number.NEGATIVE_INFINITY) < changeFloor)) return false;
      if (minVolume && (!quote || quote.volume < volumeFloor)) return false;
      return true;
    });

    return result;
  }, [companyRows, activeFilters, quoteMap, minPrice, minChange, minVolume]);

  const rows = filteredRows;

  // keep DOM focus aligned with focusIdx (after arrow key)
  useEffect(() => {
    const el = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-idx="${focusIdx}"]`);
    el?.focus({ preventScroll: false });
  }, [focusIdx]);

  useEffect(() => {
    setPage(1);
    setFocusIdx(0);
  }, [deferredQuery]);

  function handleApplyScreener(screener: SavedScreener) {
    setActiveFilters(screener.filters);
    setShowSaved(false);
  }

  function clearFilters() {
    setActiveFilters([]);
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      {/* Top header */}
      <div className="border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Stock Screener</div>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">All stocks</h1>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">NSE</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSaved(!showSaved)}
              className={`rounded p-1.5 hover:bg-accent ${
                showSaved ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-muted-foreground"
              }`}
              aria-label="Toggle saved screeners"
            >
              <BookmarkPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => { void refetch(); void companiesQuery.refetch(); }}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Refresh quotes"
            >
              <RefreshCw className={`h-4 w-4 ${quotesFetching || companiesQuery.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Fast NSE cash-market scanning with Angel One live ticks and a resilient Yahoo delayed fallback.</p>
      </div>

      {/* Saved screeners panel */}
      {showSaved && (
        <div className="border-b border-border bg-panel px-5 py-3">
          <SavedScreeners onApply={handleApplyScreener} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2 text-xs">
        <div className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-primary">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
        </div>
        <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-muted-foreground">
          Price ≥
          <input value={minPrice} onChange={(event) => setMinPrice(event.target.value)} inputMode="decimal" placeholder="Any" className="w-16 bg-transparent font-mono text-foreground outline-none" />
        </label>
        <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-muted-foreground">
          Chg % ≥
          <input value={minChange} onChange={(event) => setMinChange(event.target.value)} inputMode="decimal" placeholder="Any" className="w-14 bg-transparent font-mono text-foreground outline-none" />
        </label>
        <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-muted-foreground">
          Volume ≥
          <input value={minVolume} onChange={(event) => setMinVolume(event.target.value)} inputMode="numeric" placeholder="Any" className="w-20 bg-transparent font-mono text-foreground outline-none" />
        </label>
        {(minPrice || minChange || minVolume) && (
          <button type="button" onClick={() => { setMinPrice(""); setMinChange(""); setMinVolume(""); }} className="rounded px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            Reset quick filters
          </button>
        )}
      </div>

      {/* Tabs row */}
      <div className="border-b border-border px-4 text-xs font-medium flex items-center gap-1">
        {([
          { id: "overview", label: "Overview", icon: Table },
          { id: "performance", label: "Performance", icon: BarChart3 },
          { id: "technicals", label: "Technicals", icon: SlidersHorizontal },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setActiveView(id)} className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 ${activeView === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-2 rounded bg-accent px-2 py-0.5 text-xs hover:bg-accent/80"
          >
            Clear {activeFilters.length} filter{activeFilters.length > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Symbol"
                    className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                  <span className="ml-2 text-[10px] uppercase tracking-wider">{companiesQuery.data?.total.toLocaleString("en-IN") ?? "…"}</span>
                </div>
              </th>
              {["Price", "Chg %", "Vol", "Rel vol", "Mkt cap", "P/E", "EPS dil TTM", "EPS growth", "Div yield"].map((label) => (
                <th key={label} className="px-3 py-2.5 text-right text-tv-caps font-medium text-muted-foreground">{label}</th>
              ))}
              <th className="px-3 py-2.5 text-left text-tv-caps font-medium text-muted-foreground">ISIN</th>
              <th className="px-3 py-2.5 text-left text-tv-caps font-medium text-muted-foreground">Analyst rating</th>
            </tr>
          </thead>
          <tbody
            ref={tbodyRef}
            onKeyDown={(e: KeyboardEvent<HTMLTableSectionElement>) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocusIdx((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocusIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Home") {
                e.preventDefault(); setFocusIdx(0);
              } else if (e.key === "End") {
                e.preventDefault(); setFocusIdx(rows.length - 1);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const r = rows[focusIdx];
                if (r) setSelected(r.symbol);
              }
            }}
          >
            {rows.map((r, i) => {
              return (
                <tr
                  key={r.symbol}
                  data-idx={i}
                  tabIndex={i === focusIdx ? 0 : -1}
                  role="row"
                  aria-selected={selected === r.symbol ? true : undefined}
                  onClick={() => { setSelected(r.symbol); setFocusIdx(i); }}
                  onFocus={() => setFocusIdx(i)}
                  className={`cursor-pointer border-b border-border/60 outline-none transition-colors focus-visible:tv-row-focus ${
                    selected === r.symbol ? "tv-row-selected" : "hover:tv-row-hover"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${r.logoColor} text-[10px] font-bold text-white`}>
                        {r.logo}
                      </div>
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary">{r.symbol}</span>
                      <span className="truncate text-xs text-foreground/90">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <LivePriceCell price={quoteMap.get(r.symbol)?.price} />
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular text-tv-sm ${(quoteMap.get(r.symbol)?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                    {quoteMap.get(r.symbol)?.changePct === undefined
                      ? "—"
                      : `${quoteMap.get(r.symbol)!.changePct! >= 0 ? "+" : ""}${quoteMap.get(r.symbol)!.changePct!.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    {quoteMap.get(r.symbol)?.volume.toLocaleString("en-IN") ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    —
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    —
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    —
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    —
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    —
                  </td>
                  <td className="px-3 py-2.5 text-left font-mono text-[11px] text-muted-foreground">{r.isin || "—"}</td>
                  <td className="px-3 py-2.5 text-left text-muted-foreground">—</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-xs text-muted-foreground">
                  {companiesQuery.isError ? "Official NSE company master is temporarily unavailable." : companiesQuery.isFetching ? "Loading NSE company master…" : "No companies match the current page filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${quoteError ? "bg-bear" : "bg-bull animate-pulse"}`} />
            {quoteError ? "Quote service unavailable" : streamConnected ? "Broker stream connected" : "Yahoo delayed polling active"}
          </span>
          <span>{rows.length} page matches · {(companiesQuery.data?.universeTotal ?? 0).toLocaleString("en-IN")} NSE companies</span>
        </div>
        <div className="flex items-center gap-2 font-mono tabular">
          <button type="button" aria-label="Previous company page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded p-0.5 hover:bg-accent disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>Page {page} / {Math.max(1, companiesQuery.data?.pageCount ?? 1)}</span>
          <button type="button" aria-label="Next company page" disabled={page >= (companiesQuery.data?.pageCount ?? 1)} onClick={() => setPage((current) => current + 1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
