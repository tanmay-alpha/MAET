import { LoaderCircle, Search, X } from "lucide-react";
import { useState } from "react";
import { useCompanySearch } from "@/hooks/use-company-search";
import type { MarketCompany } from "@/lib/market-api";

export function CompanySearchInput({
  onSelect,
  placeholder = "Search symbol, company, or ISIN",
  className = "",
}: {
  onSelect: (company: MarketCompany) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const search = useCompanySearch(query);
  const items = search.data?.items ?? [];

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded border border-border bg-background py-2 pl-8 pr-8 text-xs outline-none focus:border-primary"
      />
      {search.isFetching && <LoaderCircle className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {!search.isFetching && query && (
        <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear company search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && query.trim() && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded border border-border bg-panel shadow-xl">
          {search.isError && <div className="px-3 py-3 text-xs text-bear">Company search is temporarily unavailable.</div>}
          {!search.isFetching && !search.isError && items.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">No matching NSE company.</div>}
          {items.map((company) => (
            <button
              key={company.symbol}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onSelect(company); setQuery(""); setOpen(false); }}
              className="block w-full border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-primary">{company.symbol}</span>
                <span className="text-[10px] text-muted-foreground">{company.isin}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{company.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
