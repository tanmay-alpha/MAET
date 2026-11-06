import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { MiniCandlestickChart } from "@/components/trading/mini-candlestick-chart";
import { CompanySearchInput } from "@/components/market/company-search-input";
import { sourceName } from "@/lib/quote-source";

export const Route = createFileRoute("/_app/chart-grid")({
  head: () => ({ meta: [{ title: "Chart Grid — MAET" }] }),
  component: ChartGrid,
});

const DEFAULT_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN"];
const STORAGE_KEY = "maet.chart-grid.symbols.v1";
const MAX_SYMBOLS = 9;

function ChartCard({ symbol, onRemove }: { symbol: string; onRemove: () => void }) {
  const candles = useMarketCandles(symbol, "15m", "5d");
  const bars = candles.data?.candles ?? [];
  const first = bars.at(0);
  const latest = bars.at(-1);
  // Change across the 5-day window shown, from the first bar's open to the last close.
  const changePct = first && latest && first.open > 0 ? ((latest.close - first.open) / first.open) * 100 : undefined;
  const source = candles.data ? `${sourceName(candles.data.source)}${candles.data.delayed ? " · delayed" : ""}` : "";

  return (
    <section className="min-w-0 overflow-hidden border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-1.5">
        <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
          <Link to="/chart/$symbol" params={{ symbol }} className="font-semibold text-primary hover:underline">{symbol}</Link>
          <span>{latest ? latest.close.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
          {changePct !== undefined && (
            <span className={changePct >= 0 ? "text-bull" : "text-bear"} title="Change over the 5 days shown">
              {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}% 5D
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/chart/$symbol" params={{ symbol }} aria-label={`Open ${symbol} chart`} className="text-muted-foreground hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></Link>
          <button type="button" onClick={onRemove} aria-label={`Remove ${symbol} from chart grid`} className="text-muted-foreground hover:text-bear"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {candles.isError
        ? <p className="px-4 py-6 text-center text-xs text-muted-foreground">Candles for {symbol} are unavailable right now.</p>
        : <MiniCandlestickChart candles={bars} height={230} />}
      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        <span>15m bars</span>
        <span className="inline-flex items-center gap-1.5">{candles.isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}{source}</span>
      </div>
    </section>
  );
}

function ChartGrid() {
  const [columns, setColumns] = useState<2 | 3>(2);
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (Array.isArray(stored)) {
        const valid = [...new Set(stored.filter((value): value is string => typeof value === "string" && /^[A-Z0-9&.-]+$/.test(value)))].slice(0, MAX_SYMBOLS);
        if (valid.length > 0) setSymbols(valid);
      }
    } catch {
      // Ignore malformed local preferences and keep the defaults.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }, [hydrated, symbols]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-panel px-4 py-2">
        <h1 className="font-semibold">Chart grid</h1>
        <span className="font-mono text-xs text-muted-foreground">{symbols.length}/{MAX_SYMBOLS}</span>
        <div className="flex min-w-0 flex-1 basis-full items-center justify-end gap-3 sm:basis-auto">
          <CompanySearchInput className="w-full sm:max-w-sm" placeholder="Add NSE symbol, company, or ISIN" onSelect={(company) => {
            if (symbols.includes(company.symbol)) return setNotice(`${company.symbol} is already in the grid.`);
            if (symbols.length >= MAX_SYMBOLS) return setNotice(`Chart grid supports up to ${MAX_SYMBOLS} symbols.`);
            setSymbols((current) => [...current, company.symbol]);
            setNotice(`${company.symbol} added.`);
          }} />
          {/* Below lg the grid is one column, so the column choice only applies on wide screens. */}
          <div className="hidden shrink-0 items-center rounded border border-border bg-background p-0.5 text-xs lg:flex">{([2, 3] as const).map((value) => <button key={value} type="button" onClick={() => setColumns(value)} className={`rounded px-2.5 py-1 ${columns === value ? "bg-accent text-foreground" : "text-muted-foreground"}`}>{value} columns</button>)}</div>
        </div>
      </div>
      {notice && <div role="status" className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">{notice}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {symbols.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Add a company above to start the grid.</p> : <div className={`grid gap-2 ${columns === 2 ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"}`}>{symbols.map((symbol) => <ChartCard key={symbol} symbol={symbol} onRemove={() => setSymbols((current) => current.filter((item) => item !== symbol))} />)}</div>}
      </div>
    </div>
  );
}
