import { createFileRoute, Link } from "@tanstack/react-router";
import { CandlestickChart, TrendingUp, TrendingDown } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/futures")({
  head: () => ({ meta: [{ title: "Futures — MAET" }] }),
  component: Futures,
});

const FUTURES_CONTRACTS = [
  {
    symbol: "RELIANCEFUT",
    name: "Reliance Industries",
    underlying: "RELIANCE",
    expiry: "28 Jun 2026",
    price: 2452.50,
    change: 1.15,
    volume: "2.3M",
    oi: "45.2M",
  },
  {
    symbol: "BANKNIFTYFUT",
    name: "Nifty Bank",
    underlying: "BANKNIFTY",
    expiry: "28 Jun 2026",
    price: 45234.00,
    change: -0.45,
    volume: "1.8M",
    oi: "12.5M",
  },
  {
    symbol: "NIFTYFUT",
    name: "Nifty 50",
    underlying: "NIFTY50",
    expiry: "28 Jun 2026",
    price: 23456.00,
    change: 0.85,
    volume: "15.6M",
    oi: "35.8M",
  },
];

function Futures() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <CandlestickChart className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Futures</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Filter by expiry
          </button>
          <button className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Sort by volume
          </button>
        </div>
      </div>

      {/* Contracts table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Symbol</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Underlying</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Expiry</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Price</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Change</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Volume</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">OI</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {FUTURES_CONTRACTS.map((contract) => (
              <tr key={contract.symbol} className="border-b border-border hover:bg-accent/50">
                <td className="px-4 py-2">
                  <Link
                    to={`/chart/${contract.underlying}`}
                    className="font-semibold text-foreground hover:text-primary"
                  >
                    {contract.symbol}
                  </Link>
                  <div className="text-xs text-muted-foreground">{contract.name}</div>
                </td>
                <td className="px-4 py-2">
                  <Link to={`/chart/${contract.underlying}`} className="text-muted-foreground hover:text-foreground">
                    {contract.underlying}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{contract.expiry}</td>
                <td className="px-4 py-2 text-right font-mono tabular">
                  ₹{contract.price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2 text-right">
                  <span className={`flex items-center gap-1 justify-end ${
                    contract.change >= 0 ? "text-bull" : "text-bear"
                  }`}>
                    {contract.change >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {contract.change >= 0 ? "+" : ""}{contract.change}%
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular">{contract.volume}</td>
                <td className="px-4 py-2 text-right font-mono tabular">{contract.oi}</td>
                <td className="px-4 py-2 text-right">
                  <button className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90">
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Futures data provider pending — showing major index and stock futures contracts" />
      </div>
    </div>
  );
}
