import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Calculator, CandlestickChart, DatabaseZap, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";

export const Route = createFileRoute("/_app/futures")({
  head: () => ({ meta: [{ title: "Futures — MAET" }] }),
  component: Futures,
});

type Tab = "nse" | "mcx" | "margin";

const CONTRACTS = [
  { symbol: "RELIANCEFUT", underlying: "RELIANCE", name: "Reliance Industries", lotSize: 250, basisBps: 14 },
  { symbol: "HDFCBANKFUT", underlying: "HDFCBANK", name: "HDFC Bank", lotSize: 550, basisBps: 12 },
  { symbol: "ICICIBANKFUT", underlying: "ICICIBANK", name: "ICICI Bank", lotSize: 700, basisBps: 11 },
  { symbol: "TCSFUT", underlying: "TCS", name: "Tata Consultancy Services", lotSize: 175, basisBps: 16 },
  { symbol: "NIFTYFUT", underlying: "NIFTY50", name: "Nifty 50", lotSize: 25, basisBps: 10 },
  { symbol: "BANKNIFTYFUT", underlying: "BANKNIFTY", name: "Nifty Bank", lotSize: 15, basisBps: 9 },
] as const;

function nextMonthlyExpiry(): Date {
  const now = new Date();
  for (let monthOffset = 0; monthOffset < 2; monthOffset++) {
    const year = now.getFullYear();
    const month = now.getMonth() + monthOffset;
    const date = new Date(year, month + 1, 0);
    while (date.getDay() !== 4) date.setDate(date.getDate() - 1);
    if (date.getTime() > now.getTime()) return date;
  }
  return new Date(now.getFullYear(), now.getMonth() + 1, 28);
}

function Futures() {
  const [tab, setTab] = useState<Tab>("nse");
  const [selected, setSelected] = useState<(typeof CONTRACTS)[number]["symbol"]>("RELIANCEFUT");
  const [lots, setLots] = useState(1);
  const symbols = useMemo(() => CONTRACTS.map((contract) => contract.underlying), []);
  const { quoteMap, isFetching, isError, refetch } = useMarketQuotes(symbols);
  const expiry = useMemo(() => nextMonthlyExpiry(), []);
  const selectedContract = CONTRACTS.find((contract) => contract.symbol === selected) ?? CONTRACTS[0];
  const selectedQuote = quoteMap.get(selectedContract.underlying);
  const indicativePrice = selectedQuote ? selectedQuote.price * (1 + selectedContract.basisBps / 10_000) : 0;
  const notional = indicativePrice * selectedContract.lotSize * lots;
  const estimatedMargin = notional * 0.15;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <CandlestickChart className="h-4 w-4 text-primary" />
          <span className="font-semibold">Futures desk</span>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-400">Indicative</span>
        </div>
        <div className="flex items-center gap-1 rounded border border-border bg-background p-0.5 text-xs">
          {([
            ["nse", "NSE F&O"],
            ["mcx", "MCX commodities"],
            ["margin", "Margin calculator"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded px-3 py-1.5 ${tab === id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "nse" && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>Cash-linked indicative futures · expiry {expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
            <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-1.5 hover:text-foreground">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
          <table className="w-full min-w-[1000px] text-xs">
            <thead className="sticky top-0 bg-panel text-muted-foreground">
              <tr>
                {["Contract", "Underlying", "Indicative LTP", "Change", "Cash volume", "Basis", "Lot size", "Est. margin", "Action"].map((label) => (
                  <th key={label} className={`px-4 py-2.5 font-medium ${label === "Contract" || label === "Underlying" ? "text-left" : "text-right"}`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((contract) => {
                const quote = quoteMap.get(contract.underlying);
                const futurePrice = quote ? quote.price * (1 + contract.basisBps / 10_000) : undefined;
                const margin = futurePrice ? futurePrice * contract.lotSize * 0.15 : undefined;
                return (
                  <tr key={contract.symbol} className="border-t border-border/70 hover:bg-panel-elevated/50">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-primary">{contract.symbol}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{contract.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to="/chart/$symbol" params={{ symbol: contract.underlying }} className="hover:text-primary">{contract.underlying}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{futurePrice?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                    <td className={`px-4 py-3 text-right font-mono ${(quote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {quote?.changePct === undefined ? "—" : <span className="inline-flex items-center gap-1">{quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{quote.changePct.toFixed(2)}%</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{quote?.volume.toLocaleString("en-IN") ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">+{contract.basisBps} bps</td>
                    <td className="px-4 py-3 text-right font-mono">{contract.lotSize}</td>
                    <td className="px-4 py-3 text-right font-mono">{margin ? `₹${margin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => { setSelected(contract.symbol); setTab("margin"); }} className="rounded bg-primary px-2.5 py-1 text-primary-foreground hover:opacity-90">Calculate</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isError && <div className="border-t border-border px-4 py-3 text-xs text-bear">Market quote service is unavailable.</div>}
        </div>
      )}

      {tab === "mcx" && (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-lg border border-border bg-panel p-6 text-center">
            <DatabaseZap className="mx-auto h-7 w-7 text-amber-400" />
            <h2 className="mt-3 text-lg font-semibold">MCX feed connection required</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Commodity futures are intentionally not fabricated. Connect an authorized MCX data provider to populate LTP, open interest, volume, and contract expiries.
            </p>
          </div>
        </div>
      )}

      {tab === "margin" && (
        <div className="flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-3xl border border-border bg-panel p-5">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Calculator className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Indicative margin calculator</h2>
            </div>
            <div className="grid gap-4 py-5 md:grid-cols-2">
              <label className="text-xs text-muted-foreground">Contract
                <select value={selected} onChange={(event) => setSelected(event.target.value as typeof selected)} className="mt-1.5 w-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none">
                  {CONTRACTS.map((contract) => <option key={contract.symbol} value={contract.symbol}>{contract.symbol}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">Lots
                <input type="number" min={1} value={lots} onChange={(event) => setLots(Math.max(1, Number(event.target.value) || 1))} className="mt-1.5 w-full border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none" />
              </label>
            </div>
            <dl className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2">
              {[
                ["Indicative futures price", indicativePrice ? `₹${indicativePrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"],
                ["Contract value", notional ? `₹${notional.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"],
                ["Estimated margin (15%)", estimatedMargin ? `₹${estimatedMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"],
                ["Cash quote status", selectedQuote ? "Available" : "Waiting for quote"],
              ].map(([label, value]) => (
                <div key={label} className="bg-background p-4">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">This is a risk-planning estimate based on the cash quote and a 15% margin assumption. Broker/exchange SPAN requirements take precedence.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border bg-panel px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>Market source: Yahoo delayed cash quotes</span>
        <span>Real exchange F&O feed: not connected</span>
      </div>
    </div>
  );
}
