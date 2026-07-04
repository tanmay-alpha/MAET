import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketCompanies } from "@/lib/market-api";

export const Route = createFileRoute("/_app/universe")({
  head: () => ({ meta: [{ title: "Universe — MAET" }] }),
  component: Universe,
});

const PAGE_SIZE = 50;

function formatMarketCap(value?: number): string {
  if (value === undefined) return "—";
  if (value >= 1e12) return `₹${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `₹${(value / 1e9).toFixed(2)}B`;
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">NSE Company Universe</h1></div>
            <p className="mt-1 text-xs text-muted-foreground">Official NSE identity universe with database-backed enrichment where verified.</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{companies.data?.universeTotal.toLocaleString("en-IN") ?? "—"} companies</div>
            <div>{companies.data?.source === "database" ? "PostgreSQL" : "NSE fallback"}</div>
          </div>
        </div>
        <div className="relative mt-4 max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, company name, or ISIN" aria-label="Search universe" className="w-full rounded border border-border bg-background py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[950px] text-xs">
          <thead className="sticky top-0 z-10 bg-panel text-muted-foreground">
            <tr>{["Company", "ISIN", "Price", "Change", "Volume", "Market cap", "Sector", "Bucket", "Actions"].map((label) => <th key={label} className={`border-b border-border px-4 py-2.5 font-medium ${label === "Company" || label === "ISIN" ? "text-left" : "text-right"}`}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {companies.isLoading && Array.from({ length: 10 }, (_, index) => <tr key={index} className="border-b border-border"><td colSpan={9} className="h-12 animate-pulse bg-panel/30" /></tr>)}
            {companies.data?.items.map((company) => {
              const quote = quotes.quoteMap.get(company.symbol);
              const price = quote?.price ?? company.price;
              const change = quote?.changePct ?? company.changePct;
              const volume = quote?.volume ?? company.volume;
              return (
                <tr key={company.symbol} className="border-b border-border/70 hover:bg-panel-elevated/50">
                  <td className="px-4 py-3"><div className="font-mono font-semibold text-primary">{company.symbol}</div><div className="max-w-72 truncate text-muted-foreground">{company.name}</div></td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{company.isin || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{price === undefined ? "—" : `₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}</td>
                  <td className={`px-4 py-3 text-right font-mono ${(change ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{change === undefined ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</td>
                  <td className="px-4 py-3 text-right font-mono">{volume?.toLocaleString("en-IN") ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono" title={company.marketCap === undefined ? "Market cap unavailable: no verified stored value" : company.fundamentalsSource}>{formatMarketCap(company.marketCap)}</td>
                  <td className="px-4 py-3 text-right" title={company.sector ? company.fundamentalsSource : "Sector unavailable from verified company data"}>{company.sector ?? "—"}</td>
                  <td className="px-4 py-3 text-right capitalize">{company.marketCapBucket === "unknown" ? "—" : company.marketCapBucket}</td>
                  <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Link to="/stock/$symbol" params={{ symbol: company.symbol }} className="hover:text-primary">Details</Link><Link to="/chart/$symbol" params={{ symbol: company.symbol }} className="hover:text-primary">Chart</Link></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {companies.isError && <div className="p-10 text-center text-sm text-bear">The company universe is temporarily unavailable.</div>}
        {!companies.isLoading && !companies.isError && companies.data?.items.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No NSE company matches this search.</div>}
      </div>

      <footer className="flex items-center justify-between border-t border-border bg-panel px-4 py-2 text-xs text-muted-foreground">
        <span>{companies.data?.total.toLocaleString("en-IN") ?? 0} matching companies · quotes {quotes.streamConnected ? "streaming" : "loading"}</span>
        <div className="flex items-center gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-border p-1.5 disabled:opacity-40" aria-label="Previous universe page"><ChevronLeft className="h-4 w-4" /></button><span>Page {companies.data?.page ?? page} / {companies.data?.pageCount ?? 1}</span><button type="button" disabled={!companies.data || page >= companies.data.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded border border-border p-1.5 disabled:opacity-40" aria-label="Next universe page"><ChevronRight className="h-4 w-4" /></button></div>
      </footer>
    </div>
  );
}
