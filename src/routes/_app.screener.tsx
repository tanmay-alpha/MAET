import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";


export const Route = createFileRoute("/_app/screener")({
  head: () => ({ meta: [{ title: "Stock Screener — MAET" }] }),
  component: Screener,
});

type Row = {
  symbol: string;
  name: string;
  logo: string; // single letter
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
];

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
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const screenerSymbols = useMemo(() => ROWS.map((row) => row.symbol), []);
  const { quoteMap, streamConnected, isError: quoteError, isFetching, refetch } = useMarketQuotes(screenerSymbols);

  // keep DOM focus aligned with focusIdx (after arrow key)
  useEffect(() => {
    const el = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-idx="${focusIdx}"]`);
    el?.focus({ preventScroll: false });
  }, [focusIdx]);


  const rows = useMemo(() => {
    const filtered = ROWS.filter((r) =>
      r.symbol.toLowerCase().includes(query.toLowerCase()) ||
      r.name.toLowerCase().includes(query.toLowerCase())
    );
    return [...filtered].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [query]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top header */}
      <div className="border-b border-border px-5 pt-4 pb-3">
        <div className="text-xs text-muted-foreground">Stock Screener</div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">NSE market watch</h1>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => void refetch()} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Refresh quotes"><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Price, change, and volume come from Yahoo. Fundamental and analyst columns remain blank until a verified provider is connected.</p>
      </div>

      {/* Tabs row */}
      <div className="border-b border-border px-4 py-2 text-xs font-medium">Overview</div>

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
            {rows.map((r, i) => (
              <tr
                key={r.symbol}
                data-idx={i}
                tabIndex={i === focusIdx ? 0 : -1}
                role="row"
                aria-selected={selected === r.symbol}
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
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-tv-sm">—</td>
                <td className="px-3 py-2.5 text-left text-xs text-foreground/90">{r.sector}</td>
                <td className="px-3 py-2.5 text-left text-muted-foreground">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${quoteError ? "bg-bear" : "bg-bull animate-pulse"}`} />
            {quoteError ? "Quote service unavailable" : streamConnected ? "Yahoo delayed · fundamentals unavailable" : "Connecting · NSE"}
          </span>
          <span>{rows.length} matches</span>
        </div>
        <div className="font-mono tabular">MAET Screener · v1.0</div>
      </div>
    </div>
  );
}
