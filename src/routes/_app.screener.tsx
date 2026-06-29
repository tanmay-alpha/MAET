import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RefreshCw, Search, SlidersHorizontal, Table } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { SavedScreeners, type SavedScreener, type FilterCondition, AVAILABLE_FIELDS } from "@/components/screener/saved-screeners";

export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type Row = {
  symbol: string;
  name: string;
  logo: string;
  logoColor: string;
  sector: string;
};

const ROWS: Row[] = [
  { symbol: "RELIANCE", name: "Reliance Industries Limited", logo: "R", logoColor: "bg-amber-700", sector: "Energy" },
  { symbol: "HDFCBANK", name: "HDFC Bank Limited", logo: "H", logoColor: "bg-red-600", sector: "Finance" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel Limited", logo: "B", logoColor: "bg-rose-600", sector: "Communications" },
  { symbol: "ICICIBANK", name: "ICICI Bank Limited", logo: "I", logoColor: "bg-orange-600", sector: "Finance" },
  { symbol: "SBIN", name: "State Bank of India", logo: "S", logoColor: "bg-blue-700", sector: "Finance" },
  { symbol: "TCS", name: "Tata Consultancy Services Limited", logo: "T", logoColor: "bg-slate-700", sector: "Technology" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance Limited", logo: "B", logoColor: "bg-indigo-700", sector: "Finance" },
  { symbol: "LT", name: "Larsen & Toubro Limited", logo: "L", logoColor: "bg-yellow-700", sector: "Industrials" },
  { symbol: "LICI", name: "Life Insurance Corporation of India", logo: "L", logoColor: "bg-blue-800", sector: "Finance" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever Limited", logo: "H", logoColor: "bg-blue-600", sector: "Consumer" },
  { symbol: "INFY", name: "Infosys Limited", logo: "I", logoColor: "bg-blue-500", sector: "Technology" },
  { symbol: "ITC", name: "ITC Limited", logo: "I", logoColor: "bg-yellow-600", sector: "Consumer" },
  { symbol: "MARUTI", name: "Maruti Suzuki India Limited", logo: "M", logoColor: "bg-red-700", sector: "Automotive" },
  { symbol: "AXISBANK", name: "Axis Bank Limited", logo: "A", logoColor: "bg-rose-700", sector: "Finance" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank Limited", logo: "K", logoColor: "bg-blue-900", sector: "Finance" },
  { symbol: "WIPRO", name: "Wipro Limited", logo: "W", logoColor: "bg-slate-600", sector: "Technology" },
  { symbol: "HCLTECH", name: "HCL Technologies Limited", logo: "H", logoColor: "bg-blue-700", sector: "Technology" },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries Limited", logo: "S", logoColor: "bg-green-700", sector: "Healthcare" },
  { symbol: "TATAMOTORS", name: "Tata Motors Limited", logo: "T", logoColor: "bg-blue-600", sector: "Automotive" },
  { symbol: "NTPC", name: "NTPC Limited", logo: "N", logoColor: "bg-orange-700", sector: "Energy" },
];

// Mock fundamentals data for screener columns
const MOCK_FUNDAMENTALS: Record<string, Record<string, string | number>> = {
  RELIANCE: { mktCap: "₹17,00,000Cr", pe: "24.5", eps: "91.2", epsGrowth: "12%", divYield: "0.5%" },
  HDFCBANK: { mktCap: "₹9,50,000Cr", pe: "19.2", eps: "153.4", epsGrowth: "15%", divYield: "1.2%" },
  TCS: { mktCap: "₹15,00,000Cr", pe: "26.1", eps: "145.6", epsGrowth: "8%", divYield: "1.0%" },
  INFY: { mktCap: "₹6,00,000Cr", pe: "22.8", eps: "56.7", epsGrowth: "10%", divYield: "2.4%" },
};

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
  const [showSaved, setShowSaved] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  // Get all unique symbols from ROWS and active screener filters
  const screenerSymbols = useMemo(() => ROWS.map((row) => row.symbol), []);
  const { quoteMap, streamConnected, isError: quoteError, isFetching, refetch } = useMarketQuotes(screenerSymbols);

  // Apply filters to rows
  const filteredRows = useMemo(() => {
    let result = ROWS.filter((r) =>
      r.symbol.toLowerCase().includes(query.toLowerCase()) ||
      r.name.toLowerCase().includes(query.toLowerCase())
    );

    // Apply mock filters (in real app, this would query fundamentals API)
    if (activeFilters.length > 0) {
      result = result.filter((row) => {
        const mock = MOCK_FUNDAMENTALS[row.symbol] ?? {};
        return activeFilters.every((f) => {
          const val = mock[f.field as keyof typeof mock];
          if (val === undefined) return true; // include if no data
          // Very basic mock filter logic — real implementation needs proper parsing
          return true;
        });
      });
    }

    return [...result].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [query, activeFilters]);

  const rows = filteredRows;

  // keep DOM focus aligned with focusIdx (after arrow key)
  useEffect(() => {
    const el = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-idx="${focusIdx}"]`);
    el?.focus({ preventScroll: false });
  }, [focusIdx]);

  function handleApplyScreener(screener: SavedScreener) {
    setActiveFilters(screener.filters);
    setShowSaved(false);
  }

  function clearFilters() {
    setActiveFilters([]);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top header */}
      <div className="border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Stock Screener</div>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">NSE market watch</h1>
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
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Refresh quotes"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Price, change, and volume come from Yahoo. Fundamental columns use mock data until a provider is connected.
        </p>
      </div>

      {/* Saved screeners panel */}
      {showSaved && (
        <div className="border-b border-border bg-panel px-5 py-3">
          <SavedScreeners onApply={handleApplyScreener} />
        </div>
      )}

      {/* Tabs row */}
      <div className="border-b border-border px-4 py-2 text-xs font-medium flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Table className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Overview</span>
        </div>
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded bg-accent px-2 py-0.5 text-xs hover:bg-accent/80"
          >
            Clear {activeFilters.length} filter{activeFilters.length > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
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
                  <span className="ml-2 text-[10px] uppercase tracking-wider">{rows.length}</span>
                </div>
              </th>
              {["Price", "Chg %", "Vol", "Rel vol", "Mkt cap", "P/E", "EPS dil TTM", "EPS growth", "Div yield"].map((label) => (
                <th key={label} className="px-3 py-2.5 text-right text-tv-caps font-medium text-muted-foreground">{label}</th>
              ))}
              <th className="px-3 py-2.5 text-left text-tv-caps font-medium text-muted-foreground">Sector</th>
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
              const fundamentals = MOCK_FUNDAMENTALS[r.symbol] ?? {};
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
                    {fundamentals.mktCap ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    {fundamentals.pe ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    {fundamentals.eps ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    {fundamentals.epsGrowth ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">
                    {fundamentals.divYield ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-left text-xs text-foreground/90">{r.sector}</td>
                  <td className="px-3 py-2.5 text-left text-muted-foreground">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${quoteError ? "bg-bear" : "bg-bull animate-pulse"}`} />
            {quoteError ? "Quote service unavailable" : streamConnected ? "Yahoo delayed · fundamentals mock" : "Connecting · NSE"}
          </span>
          <span>{rows.length} matches</span>
        </div>
        <div className="font-mono tabular">MAET Screener · v1.0</div>
      </div>
    </div>
  );
}