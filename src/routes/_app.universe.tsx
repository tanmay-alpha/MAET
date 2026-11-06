import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketCompanies } from "@/lib/market-api";
import { quoteSourceLabel } from "@/lib/quote-source";

export const Route = createFileRoute("/_app/universe")({
  head: () => ({ meta: [{ title: "Universe — MAET" }] }),
  component: Universe,
});

const PAGE_SIZE = 50;

function formatMarketCap(value?: number): string {
  if (value === undefined) return "—";
  return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function Universe() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const companies = useQuery({
    queryKey: ["universe", page, debouncedQuery],
    queryFn: ({ signal }) => fetchMarketCompanies(page, PAGE_SIZE, debouncedQuery, signal),
    placeholderData: (previous) => previous,
  });
  const symbols = useMemo(() => companies.data?.items.map((company) => company.symbol) ?? [], [companies.data?.items]);
  const quotes = useMarketQuotes(symbols);
  // With the database offline the API serves the NSE master list only: market cap, sector
  // and bucket would be a dash on every row, so those columns are dropped instead.
  const offline = companies.data?.source === "nse-fallback";
  const quoteLabel = quotes.isError
    ? "quotes unavailable"
    : quotes.data
      ? `quotes: ${quoteSourceLabel(quotes.data.source, quotes.delayed, quotes.marketPhase)}`
      : "loading quotes…";
  const columns = [
    { label: "Company", className: "text-left" },
    { label: "ISIN", className: "hidden text-left md:table-cell" },
    { label: "Price", className: "text-right" },
    { label: "Chg %", className: "text-right" },
    { label: "Volume", className: "hidden text-right sm:table-cell" },
    ...(offline ? [] : [
      { label: "Market cap", className: "text-right" },
      { label: "Sector", className: "text-left" },
      { label: "Bucket", className: "text-left" },
    ]),
    { label: "", className: "" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">Company universe</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {companies.data ? `${companies.data.universeTotal.toLocaleString("en-IN")} NSE companies` : "Loading…"}
          </span>
        </div>
        {offline && (
          <p className="mt-1 text-[11px] text-amber-300/90">
            Database offline: NSE company list with live quotes only. Market cap and sector return when it reconnects.
          </p>
        )}
        <label className="mt-2 flex max-w-xl items-center gap-2 rounded border border-border bg-panel px-3 py-1.5 focus-within:border-primary/60">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, company name, or ISIN" aria-label="Search universe" className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none" />
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className={`w-full text-xs ${offline ? "" : "min-w-[860px]"}`}>
          <thead className="sticky top-0 z-10 bg-panel text-muted-foreground">
            <tr>{columns.map((column) => <th key={column.label || "actions"} className={`border-b border-border px-3 py-2 font-medium ${column.className}`}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {companies.isLoading && Array.from({ length: 10 }, (_, index) => <tr key={index} className="border-b border-border"><td colSpan={columns.length} className="h-10 animate-pulse bg-panel/30" /></tr>)}
            {companies.data?.items.map((company) => {
              const quote = quotes.quoteMap.get(company.symbol);
              const price = quote?.price ?? company.price;
              const change = quote?.changePct ?? company.changePct;
              const volume = quote?.volume ?? company.volume;
              return (
                <tr key={company.symbol} className="border-b border-border/70 hover:bg-panel-elevated/50">
                  <td className="max-w-[11rem] px-3 py-2 sm:max-w-72">
                    <Link to="/stock/$symbol" params={{ symbol: company.symbol }} className="font-mono font-semibold text-primary hover:underline">{company.symbol}</Link>
                    <div className="truncate text-muted-foreground">{company.name}</div>
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-muted-foreground md:table-cell">{company.isin || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{price === undefined ? "—" : `₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${change === undefined ? "text-muted-foreground" : change >= 0 ? "text-bull" : "text-bear"}`}>{change === undefined ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</td>
                  <td className="hidden px-3 py-2 text-right font-mono tabular-nums sm:table-cell">{volume?.toLocaleString("en-IN") ?? "—"}</td>
                  {!offline && (
                    <>
                      <td className="px-3 py-2 text-right font-mono tabular-nums" title={company.marketCap === undefined ? "No stored market cap for this company" : company.fundamentalsSource}>{formatMarketCap(company.marketCap)}</td>
                      <td className="px-3 py-2" title={company.sector ? company.fundamentalsSource : "No stored sector for this company"}>{company.sector ?? "—"}</td>
                      <td className="px-3 py-2 capitalize">{company.marketCapBucket === "unknown" ? "—" : company.marketCapBucket}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right"><Link to="/chart/$symbol" params={{ symbol: company.symbol }} className="text-muted-foreground hover:text-primary">Chart</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {companies.isError && <p className="p-6 text-center text-sm text-bear">The company list is unavailable right now.</p>}
        {!companies.isLoading && !companies.isError && companies.data?.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No NSE company matches this search.</p>}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-panel px-4 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{companies.data?.total.toLocaleString("en-IN") ?? 0} matching · {quoteLabel}</span>
        <div className="flex shrink-0 items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-border p-1 disabled:opacity-40" aria-label="Previous universe page"><ChevronLeft className="h-4 w-4" /></button><span className="font-mono tabular-nums">{companies.data?.page ?? page}/{companies.data?.pageCount ?? 1}</span><button type="button" disabled={!companies.data || page >= companies.data.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded border border-border p-1 disabled:opacity-40" aria-label="Next universe page"><ChevronRight className="h-4 w-4" /></button></div>
      </footer>
    </div>
  );
}
