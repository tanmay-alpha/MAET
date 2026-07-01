import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CandlestickChart, TrendingUp, TrendingDown, Calculator, Wheat, Gem, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";
import { DataBadge } from "@/components/common/data-badge";

export const Route = createFileRoute("/_app/futures")({
  head: () => ({ meta: [{ title: "Futures — MAET" }] }),
  component: Futures,
});

type TabType = "futures" | "commodities" | "margin";

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
    lotSize: 250,
    margin: 125000,
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
    lotSize: 15,
    margin: 95000,
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
    lotSize: 25,
    margin: 85000,
  },
  {
    symbol: "HDFCBANFUT",
    name: "HDFC Bank",
    underlying: "HDFCBANK",
    expiry: "28 Jun 2026",
    price: 1680.25,
    change: 0.32,
    volume: "1.2M",
    oi: "8.4M",
    lotSize: 500,
    margin: 72000,
  },
  {
    symbol: "ICICIBANFUT",
    name: "ICICI Bank",
    underlying: "ICICIBANK",
    expiry: "28 Jun 2026",
    price: 1245.60,
    change: -0.18,
    volume: "0.9M",
    oi: "6.2M",
    lotSize: 625,
    margin: 68000,
  },
];

const COMMODITIES = [
  {
    symbol: "GOLD",
    name: "Gold Futures",
    exchange: "MCX",
    price: 78560,
    change: 0.85,
    unit: "per 10gm",
    lotSize: 1,
    margin: 45000,
  },
  {
    symbol: "SILVER",
    name: "Silver Futures",
    exchange: "MCX",
    price: 89250,
    change: -1.23,
    unit: "per 1kg",
    lotSize: 1,
    margin: 65000,
  },
  {
    symbol: "CRUDEOIL",
    name: "Crude Oil",
    exchange: "MCX",
    price: 5842,
    change: 2.15,
    unit: "per barrel",
    lotSize: 100,
    margin: 35000,
  },
  {
    symbol: "NATURALGAS",
    name: "Natural Gas",
    exchange: "MCX",
    price: 245,
    change: -0.67,
    unit: "per mmBtu",
    lotSize: 2500,
    margin: 28000,
  },
  {
    symbol: "COPPER",
    name: "Copper Futures",
    exchange: "MCX",
    price: 745.50,
    change: 1.45,
    unit: "per 1kg",
    lotSize: 250,
    margin: 32000,
  },
  {
    symbol: "ZINC",
    name: "Zinc Futures",
    exchange: "MCX",
    price: 235.80,
    change: 0.92,
    unit: "per 1kg",
    lotSize: 500,
    margin: 22000,
  },
];

function Futures() {
  const [activeTab, setActiveTab] = useState<TabType>("futures");
  const [sortBy, setSortBy] = useState<"volume" | "change" | "oi">("volume");
  const [filterExpiry, setFilterExpiry] = useState<string>("all");

  const sortedContracts = [...FUTURES_CONTRACTS].sort((a, b) => {
    if (sortBy === "volume") return parseFloat(b.volume) - parseFloat(a.volume);
    if (sortBy === "change") return Math.abs(b.change) - Math.abs(a.change);
    return parseFloat(b.oi) - parseFloat(a.oi);
  });

  const filteredContracts = filterExpiry === "all"
    ? sortedContracts
    : sortedContracts.filter(c => c.expiry === filterExpiry);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <CandlestickChart className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Futures & Commodities</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("futures")}
            className={`rounded-md border px-3 py-1.5 ${
              activeTab === "futures"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Stock Futures
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("commodities")}
            className={`rounded-md border px-3 py-1.5 ${
              activeTab === "commodities"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Commodities
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("margin")}
            className={`rounded-md border px-3 py-1.5 ${
              activeTab === "margin"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Margin Calculator
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "futures" && (
          <FuturesTable
            contracts={filteredContracts}
            sortBy={sortBy}
            onSortChange={setSortBy}
            filterExpiry={filterExpiry}
            onFilterChange={setFilterExpiry}
          />
        )}
        {activeTab === "commodities" && <CommoditiesTable />}
        {activeTab === "margin" && <MarginCalculator />}
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Futures data from NSE/BSE/MCX — margin calculations are estimates" />
      </div>
    </div>
  );
}

interface FuturesTableProps {
  contracts: typeof FUTURES_CONTRACTS;
  sortBy: string;
  onSortChange: (sort: "volume" | "change" | "oi") => void;
  filterExpiry: string;
  onFilterChange: (filter: string) => void;
}

function FuturesTable({ contracts, sortBy, onSortChange, filterExpiry, onFilterChange }: FuturesTableProps) {
  return (
    <div>
      {/* Filters */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Expiry:</span>
          <button
            type="button"
            onClick={() => onFilterChange("all")}
            className={`rounded border px-2 py-1 text-xs ${
              filterExpiry === "all"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("28 Jun 2026")}
            className={`rounded border px-2 py-1 text-xs ${
              filterExpiry === "28 Jun 2026"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            28 Jun
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("31 Jul 2026")}
            className={`rounded border px-2 py-1 text-xs ${
              filterExpiry === "31 Jul 2026"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            31 Jul
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as "volume" | "change" | "oi")}
            aria-label="Sort futures contracts"
            className="rounded border border-border bg-panel px-2 py-1 text-xs outline-none focus:border-primary"
          >
            <option value="volume">Volume</option>
            <option value="change">Change</option>
            <option value="oi">Open Interest</option>
          </select>
        </div>
      </div>

      {/* Table */}
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
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Lot Size</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Est. Margin</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Action</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr key={contract.symbol} className="border-b border-border hover:bg-accent/50">
              <td className="px-4 py-3">
                <Link
                  to={`/chart/${contract.underlying}` as any}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  {contract.symbol}
                </Link>
                <div className="text-xs text-muted-foreground">{contract.name}</div>
              </td>
              <td className="px-4 py-3">
                <Link to={`/chart/${contract.underlying}` as any} className="text-muted-foreground hover:text-foreground">
                  {contract.underlying}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{contract.expiry}</td>
              <td className="px-4 py-3 text-right font-mono tabular">
                ₹{contract.price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-3 text-right">
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
              <td className="px-4 py-3 text-right font-mono tabular">{contract.volume}</td>
              <td className="px-4 py-3 text-right font-mono tabular">{contract.oi}</td>
              <td className="px-4 py-3 text-right font-mono tabular text-muted-foreground">{contract.lotSize}</td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono tabular text-xs text-muted-foreground">
                  ₹{contract.margin.toLocaleString("en-IN")}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  to={`/chart/${contract.underlying}` as any}
                  className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommoditiesTable() {
  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Gem className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium">MCX Commodities</span>
          <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400">LIVE</span>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Symbol</th>
            <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Exchange</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Price</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Change</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Unit</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Lot Size</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Est. Margin</th>
            <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Action</th>
          </tr>
        </thead>
        <tbody>
          {COMMODITIES.map((commodity) => (
            <tr key={commodity.symbol} className="border-b border-border hover:bg-accent/50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className={`rounded p-1 ${
                    commodity.symbol === "GOLD" || commodity.symbol === "SILVER"
                      ? "bg-amber-400/10 text-amber-400"
                      : commodity.symbol === "CRUDEOIL" || commodity.symbol === "NATURALGAS"
                      ? "bg-emerald-400/10 text-emerald-400"
                      : "bg-blue-400/10 text-blue-400"
                  }`}>
                    {commodity.symbol === "GOLD" || commodity.symbol === "SILVER" ? (
                      <Gem className="h-3.5 w-3.5" />
                    ) : (
                      <BarChart3 className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold">{commodity.symbol}</div>
                    <div className="text-xs text-muted-foreground">{commodity.name}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{commodity.exchange}</td>
              <td className="px-4 py-3 text-right font-mono tabular">
                ₹{commodity.price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={`flex items-center gap-1 justify-end font-mono tabular ${
                  commodity.change >= 0 ? "text-bull" : "text-bear"
                }`}>
                  {commodity.change >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {commodity.change >= 0 ? "+" : ""}{commodity.change}%
                </span>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{commodity.unit}</td>
              <td className="px-4 py-3 text-right font-mono tabular text-muted-foreground">{commodity.lotSize}</td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono tabular text-xs text-muted-foreground">
                  ₹{commodity.margin.toLocaleString("en-IN")}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <button type="button" className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90">
                  Trade
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarginCalculator() {
  const [selectedContract, setSelectedContract] = useState<string>("RELIANCEFUT");
  const [positionType, setPositionType] = useState<"long" | "short">("long");
  const [quantity, setQuantity] = useState<number>(1);

  const contract = FUTURES_CONTRACTS.find(c => c.symbol === selectedContract) || FUTURES_CONTRACTS[0];
  const contractValue = contract.price * contract.lotSize * quantity;
  const spanMargin = contractValue * 0.05; // ~5% of contract value
  const exposureMargin = contractValue * 0.07; // ~7% exposure margin
  const totalMargin = spanMargin + exposureMargin;
  const brokerage = Math.max(20, contractValue * 0.0003); // 0.03% or min ₹20

  return (
    <div className="p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Margin Calculator</h2>
        </div>

        <div className="rounded-lg border border-border bg-panel p-5">
          {/* Inputs */}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Contract</label>
              <select
                value={selectedContract}
                onChange={(e) => setSelectedContract(e.target.value)}
                aria-label="Select futures contract"
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {FUTURES_CONTRACTS.map(c => (
                  <option key={c.symbol} value={c.symbol}>{c.symbol}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Position</label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPositionType("long")}
                  className={`flex-1 rounded border py-2 text-sm ${
                    positionType === "long"
                      ? "border-bull bg-bull/10 text-bull"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Long
                </button>
                <button
                  type="button"
                  onClick={() => setPositionType("short")}
                  className={`flex-1 rounded border py-2 text-sm ${
                    positionType === "short"
                      ? "border-bear bg-bear/10 text-bear"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Short
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Quantity (Lots)</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                aria-label="Quantity in lots"
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Contract Info */}
          <div className="mt-5 grid grid-cols-3 gap-4 rounded bg-background p-3">
            <div>
              <div className="text-xs text-muted-foreground">Current Price</div>
              <div className="font-mono font-semibold">₹{contract.price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Lot Size</div>
              <div className="font-mono font-semibold">{contract.lotSize}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Contract Value</div>
              <div className="font-mono font-semibold">₹{contractValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            </div>
          </div>

          {/* Margin Breakdown */}
          <div className="mt-5">
            <div className="text-sm font-medium">Margin Required</div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded bg-background p-2">
                <span className="text-xs text-muted-foreground">SPAN Margin</span>
                <span className="font-mono tabular text-sm">₹{spanMargin.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-background p-2">
                <span className="text-xs text-muted-foreground">Exposure Margin</span>
                <span className="font-mono tabular text-sm">₹{exposureMargin.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-background p-2">
                <span className="text-xs text-muted-foreground">Estimated Brokerage</span>
                <span className="font-mono tabular text-sm">₹{brokerage.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 p-3">
                <span className="font-medium">Total Margin Required</span>
                <span className="font-mono tabular text-lg font-bold text-primary">
                  ₹{(totalMargin + brokerage).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Risk Metrics */}
          <div className="mt-5">
            <div className="text-sm font-medium">Risk Metrics</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="rounded border border-border bg-background p-3 text-center">
                <div className="text-xs text-muted-foreground">1% Move</div>
                <div className="font-mono text-sm font-semibold text-bear">
                  ₹{(contractValue * 0.01).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded border border-border bg-background p-3 text-center">
                <div className="text-xs text-muted-foreground">2% Move</div>
                <div className="font-mono text-sm font-semibold text-bear">
                  ₹{(contractValue * 0.02).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded border border-border bg-background p-3 text-center">
                <div className="text-xs text-muted-foreground">5% Move</div>
                <div className="font-mono text-sm font-semibold text-bear">
                  ₹{(contractValue * 0.05).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded border border-border/50 bg-muted/50 p-3 text-center text-xs text-muted-foreground">
            Margin calculations are estimates. Actual margins may vary. Check with your broker.
          </div>
        </div>
      </div>
    </div>
  );
}