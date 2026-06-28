import { createFileRoute } from "@tanstack/react-router";
import { Search, Filter, TrendingUp, TrendingDown, Star } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { DataBadge } from "@/components/common/data-badge";
import { CONTRACT_PANEL } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/universe")({
  head: () => ({ meta: [{ title: "Universe — MAET" }] }),
  component: Universe,
});

const UNIVERSE_STOCKS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", price: 2445, change: 1.2, marketCap: "16.5T" },
  { symbol: "TCS", name: "Tata Consultancy", sector: "Technology", price: 3520, change: -0.5, marketCap: "13.2T" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Finance", price: 1650, change: 0.8, marketCap: "12.0T" },
  { symbol: "INFY", name: "Infosys", sector: "Technology", price: 1845, change: 1.5, marketCap: "8.5T" },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Finance", price: 1336, change: -0.3, marketCap: "9.5T" },
  { symbol: "SBIN", name: "State Bank", sector: "Finance", price: 1026, change: 1.1, marketCap: "9.3T" },
  { symbol: "LT", name: "L&T", sector: "Industrial", price: 4207, change: 0.6, marketCap: "5.7T" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto", sector: "Automotive", price: 4550, change: -1.2, marketCap: "5.2T" },
];

function Universe() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Search className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Universe</h1>
        </div>

        {/* Search and filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search symbols..."
              className="w-full rounded-md border border-border bg-panel pl-8 pr-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <button className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            <Filter className="h-3.5 w-3.5 mr-1 inline" /> Filters
          </button>
          <div className="flex gap-1">
            <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Energy
            </button>
            <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Technology
            </button>
            <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Finance
            </button>
            <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              + Add sector
            </button>
          </div>
        </div>
      </div>

      {/* Stock list */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-2 p-4">
          {UNIVERSE_STOCKS.map((stock) => (
            <div
              key={stock.symbol}
              className="group rounded-lg border border-border bg-panel p-3 transition hover:border-primary/40"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                    {stock.symbol.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold">{stock.symbol}</div>
                    <div className="text-sm text-muted-foreground">{stock.name}</div>
                  </div>
                  <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                    <span>{stock.sector}</span>
                    <DataBadge label="Market Cap" value={stock.marketCap} />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono tabular font-semibold">₹{stock.price.toLocaleString("en-IN")}</div>
                    <div className="flex items-center justify-end gap-1 text-sm">
                      {stock.change >= 0 ? (
                        <TrendingUp className="h-3 w-3 text-bull" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-bear" />
                      )}
                      <span className={stock.change >= 0 ? "text-bull" : "text-bear"}>
                        {stock.change >= 0 ? "+" : ""}{stock.change}%
                      </span>
                    </div>
                  </div>

                  <button className="rounded-md bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground group-hover:bg-accent">
                    View
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <CONTRACT_PANEL message="Universe browser showing top NSE/BSE stocks — data provided by Yahoo Finance" />
      </div>
    </div>
  );
}
