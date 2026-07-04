import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, Grid2X2, RefreshCw, X } from "lucide-react";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { MiniCandlestickChart } from "@/components/trading/mini-candlestick-chart";
import { CompanySearchInput } from "@/components/market/company-search-input";

export const Route = createFileRoute("/_app/chart-grid")({
  head: () => ({ meta: [{ title: "Chart Grid — MAET" }] }),
  component: ChartGrid,
});

const DEFAULT_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN"];
const STORAGE_KEY = "maet.chart-grid.symbols.v1";
const MAX_SYMBOLS = 9;

function ChartCard({ symbol, onRemove }: { symbol: string; onRemove: () => void }) {
  const candles = useMarketCandles(symbol, "15m", "5d");
  const latest = candles.data?.candles.at(-1);
  const previous = candles.data?.candles.at(-2);
  const changePct = latest && previous ? ((latest.close - previous.close) / previous.close) * 100 : undefined;

  return (
    <section className="min-w-0 overflow-hidden border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-primary">{symbol}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{latest?.close.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</span>
          <span className={`font-mono text-[11px] ${(changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{changePct === undefined ? "" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/chart/$symbol" params={{ symbol }} aria-label={`Open ${symbol} chart`} className="text-muted-foreground hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></Link>
          <button type="button" onClick={onRemove} aria-label={`Remove ${symbol} from chart grid`} className="text-muted-foreground hover:text-bear"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {candles.isError ? <div className="flex h-[230px] items-center justify-center px-4 text-center text-xs text-bear">Verified candle data is unavailable for {symbol}.</div> : <MiniCandlestickChart candles={candles.data?.candles ?? []} height={230} />}
      <div className="flex items-center justify-between border-t border-border bg-panel px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"><span>15m · 5D</span><span className="inline-flex items-center gap-1.5">{candles.isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}{candles.data?.source === "database" ? "DB stored" : "Yahoo delayed"}</span></div>
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
      // Ignore malformed local preferences and keep verified defaults.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }, [hydrated, symbols]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-2"><Grid2X2 className="h-4 w-4 text-primary" /><span className="font-semibold">Chart grid</span><span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">{symbols.length}/{MAX_SYMBOLS} symbols</span></div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <CompanySearchInput className="w-full max-w-sm" placeholder="Add NSE symbol, company, or ISIN" onSelect={(company) => {
            if (symbols.includes(company.symbol)) return setNotice(`${company.symbol} is already in the grid.`);
            if (symbols.length >= MAX_SYMBOLS) return setNotice(`Chart grid supports up to ${MAX_SYMBOLS} symbols.`);
            setSymbols((current) => [...current, company.symbol]);
            setNotice(`${company.symbol} added.`);
          }} />
          <div className="flex shrink-0 items-center rounded border border-border bg-background p-0.5 text-xs">{([2, 3] as const).map((value) => <button key={value} type="button" onClick={() => setColumns(value)} className={`rounded px-2.5 py-1 ${columns === value ? "bg-accent text-foreground" : "text-muted-foreground"}`}>{value} columns</button>)}</div>
        </div>
      </div>
      {notice && <div className="border-b border-border bg-panel px-4 py-1.5 text-xs text-muted-foreground">{notice}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {symbols.length === 0 ? <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Add a verified NSE company to start the chart grid.</div> : <div className={`grid gap-2 ${columns === 2 ? "xl:grid-cols-2" : "lg:grid-cols-2 2xl:grid-cols-3"}`}>{symbols.map((symbol) => <ChartCard key={symbol} symbol={symbol} onRemove={() => setSymbols((current) => current.filter((item) => item !== symbol))} />)}</div>}
      </div>
    </div>
  );
}
