import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Building2, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { CandlestickChart, type ChartState } from "@/components/trading/candlestick-chart";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchCompanyDetail, type FinancialStatement } from "@/lib/market-api";
import { getTradingViewUrl } from "@/lib/tradingview";

export const Route = createFileRoute("/_app/stock/$symbol")({
  head: () => ({ meta: [{ title: "Company Intelligence — MAET" }] }),
  component: StockDetail,
});

type DetailTab = "overview" | "balance_sheet" | "income_statement" | "cash_flow" | "ratios";
type PeriodType = "annual" | "quarterly";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "balance_sheet", label: "Balance Sheet" },
  { id: "income_statement", label: "Profit & Loss" },
  { id: "cash_flow", label: "Cash Flow" },
  { id: "ratios", label: "Ratios" },
];

const STATEMENT_ROWS: Record<Exclude<DetailTab, "overview" | "ratios">, Array<[keyof FinancialStatement, string]>> = {
  balance_sheet: [
    ["totalAssets", "Total assets"], ["currentAssets", "Current assets"], ["cashAndEquivalents", "Cash & equivalents"],
    ["inventory", "Inventory"], ["totalLiabilities", "Total liabilities"], ["currentLiabilities", "Current liabilities"],
    ["totalDebt", "Total debt"], ["shareholdersEquity", "Shareholders' equity"],
  ],
  income_statement: [
    ["revenue", "Revenue"], ["costOfRevenue", "Cost of revenue"], ["operatingIncome", "Operating income"],
    ["ebitda", "EBITDA"], ["ebit", "EBIT"], ["interestExpense", "Interest expense"],
    ["taxExpense", "Tax expense"], ["netIncome", "Net income"],
  ],
  cash_flow: [
    ["operatingCashFlow", "Operating cash flow"], ["capitalExpenditure", "Capital expenditure"],
    ["dividendsPaid", "Dividends paid"],
  ],
};

const RATIO_FIELDS: Array<[string, string, "number" | "percent" | "currency"]> = [
  ["marketCap", "Market cap", "currency"], ["trailingPe", "P/E (TTM)", "number"], ["forwardPe", "Forward P/E", "number"],
  ["pb", "Price / book", "number"], ["epsTtm", "EPS (TTM)", "currency"], ["bookValuePerShare", "Book value / share", "currency"],
  ["roe", "ROE", "percent"], ["roce", "ROCE", "percent"], ["roa", "ROA", "percent"],
  ["debtToEquity", "Debt / equity", "number"], ["currentRatio", "Current ratio", "number"],
  ["salesGrowth", "Sales growth", "percent"], ["profitGrowth", "Profit growth", "percent"],
  ["operatingMargin", "Operating margin", "percent"], ["netMargin", "Net margin", "percent"],
  ["dividendYield", "Dividend yield", "percent"], ["relVolume", "Relative volume", "number"],
];

function formatNumber(value: number | undefined, mode: "number" | "percent" | "currency" = "number"): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (mode === "percent") return `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(2)}%`;
  if (mode === "currency") {
    if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function Missing({ reason }: { reason: string }) {
  return <span className="cursor-help text-muted-foreground" title={reason}>—</span>;
}

function StatementTable({ statements, tab, reason }: {
  statements: FinancialStatement[];
  tab: Exclude<DetailTab, "overview" | "ratios">;
  reason: string;
}) {
  const relevant = statements
    .filter((statement) => statement.statementType === tab || statement.statementType === "combined" ||
      STATEMENT_ROWS[tab].some(([field]) => statement[field] !== undefined))
    .slice(0, 6);
  if (relevant.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-border bg-panel/40 p-8 text-center">
        <div><div className="font-medium">No verified statement stored</div><p className="mt-2 max-w-xl text-xs text-muted-foreground">{reason}</p></div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="bg-panel">
          <tr><th className="sticky left-0 bg-panel px-4 py-3 text-left text-muted-foreground">INR · reported units</th>
            {relevant.map((statement) => <th key={statement.id} className="px-4 py-3 text-right font-mono">{new Date(statement.periodDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</th>)}
          </tr>
        </thead>
        <tbody>{STATEMENT_ROWS[tab].map(([field, label]) => (
          <tr key={field} className="border-t border-border/70 hover:bg-accent/30">
            <th className="sticky left-0 bg-background px-4 py-3 text-left font-medium">{label}</th>
            {relevant.map((statement) => <td key={statement.id} className="px-4 py-3 text-right font-mono tabular-nums">{formatNumber(statement[field] as number | undefined, "currency")}</td>)}
          </tr>
        ))}</tbody>
      </table>
      <div className="border-t border-border bg-panel/50 px-4 py-2 text-[10px] text-muted-foreground">
        Source: {relevant[0].source} · stored {new Date(relevant[0].asOf).toLocaleString("en-IN")}
      </div>
    </div>
  );
}

function StockDetail() {
  const { symbol } = Route.useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [periodType, setPeriodType] = useState<PeriodType>("annual");
  const [chartState, setChartState] = useState<ChartState>({ zoom: 1, panOffset: 0, drawings: [] });
  const detailQuery = useQuery({
    queryKey: ["company-detail", symbol],
    queryFn: ({ signal }) => fetchCompanyDetail(symbol, signal),
    staleTime: 60_000,
    retry: 1,
  });
  const fallbackCandles = useMarketCandles(symbol, "1d", "1y");
  const { quoteMap, streamConnected } = useMarketQuotes([symbol]);
  const detail = detailQuery.data;
  const quote = quoteMap.get(symbol) ?? detail?.quote;
  const quoteAsOf = quote && "ts" in quote ? quote.ts : detail?.quote?.asOf;
  const chartData = useMemo(() => {
    const candleSource = detail?.candles.length ? detail.candles : fallbackCandles.data?.candles ?? [];
    return candleSource.map((candle) => ({
      t: new Date(candle.ts).getTime(), o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: candle.volume,
    }));
  }, [detail?.candles, fallbackCandles.data?.candles]);

  if (detailQuery.isLoading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading stored company intelligence…</div>;
  if (!detail) return (
    <div className="flex h-full items-center justify-center p-8 text-center"><div>
      <div className="text-lg font-semibold">Company data unavailable</div>
      <p className="mt-2 text-sm text-muted-foreground">{detailQuery.error instanceof Error ? detailQuery.error.message : "The company could not be loaded."}</p>
      <button type="button" className="mt-4 rounded border border-border px-3 py-2 text-sm" onClick={() => navigate({ to: "/screener" })}>Back to screener</button>
      </div>
    </div>
  );

  const statements = detail.statements[periodType];
  const availabilityKey = activeTab === "balance_sheet" ? "balanceSheet" : activeTab === "income_statement" ? "incomeStatement" : "cashFlow";
  const statementAvailability = detail.availability[availabilityKey];

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-panel/60 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate({ to: "/screener" })} className="rounded border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Back to screener"><ArrowLeft className="h-4 w-4" /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 font-semibold text-primary">{symbol[0]}</div>
            <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold">{detail.master.name}</h1><span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{symbol}</span></div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>NSE · Equity</span><span>ISIN {detail.master.isin || "—"}</span>{detail.master.sector && <span>{detail.master.sector}</span>}</div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right"><div className="font-mono text-2xl font-semibold tabular-nums">{quote?.price !== undefined ? `₹${quote.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</div>
              <div className={`font-mono text-xs ${(quote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{quote?.changePct === undefined ? "Quote unavailable" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}% · ${streamConnected ? "live stream" : quote.source}`}</div></div>
            <button type="button" onClick={() => void detailQuery.refetch()} className="rounded border border-border p-2 text-muted-foreground hover:bg-accent" aria-label="Refresh company data"><RefreshCw className={`h-4 w-4 ${detailQuery.isFetching ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-5">
        {TABS.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium ${activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}
      </div>

      <main className="min-w-0 flex-1 overflow-auto p-5">
        {activeTab === "overview" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-xl border border-border bg-panel/30">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold">Stored price history</h2><p className="text-[11px] text-muted-foreground">DB first · Yahoo delayed fallback</p></div>
              <button type="button" onClick={() => navigate({ to: `/chart/${symbol}` })} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"><BarChart3 className="h-3.5 w-3.5" />Full chart</button></div>
            {chartData.length > 1 ? <CandlestickChart data={chartData} height={380} chartState={chartState} onChartStateChange={setChartState} drawingTool={null} indicators={{ sma: false, ema: false, rsi: false, macd: false, volume: true }} /> :
              <div className="flex h-[380px] items-center justify-center text-xs text-muted-foreground">{detail.availability.history.reason}</div>}
          </section>
          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-panel/40 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><Building2 className="h-4 w-4 text-primary" />Company identity</div>
              <dl className="mt-3 space-y-2 text-xs">{[["Sector", detail.master.sector], ["Industry", detail.master.industry], ["Cap bucket", detail.master.marketCapBucket], ["Yahoo symbol", detail.master.yahooSymbol], ["BSE code", detail.master.bseCode]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-mono">{value || <Missing reason={label === "BSE code" ? "BSE code not yet verified" : `${label} unavailable from stored sources`} />}</dd></div>)}</dl>
            </div>
            <div className="rounded-xl border border-border bg-panel/40 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-bull" />Data provenance</div>
              <div className="mt-3 space-y-2 text-[11px] text-muted-foreground"><p>Master: NSE official company list</p><p>Quote: {quote?.source ?? "unavailable"}{quoteAsOf ? ` · ${new Date(quoteAsOf).toLocaleString("en-IN")}` : ""}</p><p>Fundamentals: {detail.fundamentals?.source ?? "no verified snapshot"}</p><p>Statements: {detail.availability.balanceSheet.source ?? "no verified snapshot"}</p></div>
            </div>
            <a href={getTradingViewUrl(symbol)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs hover:bg-accent">Open TradingView <ExternalLink className="h-3.5 w-3.5" /></a>
          </aside>
        </div>}

        {(activeTab === "balance_sheet" || activeTab === "income_statement" || activeTab === "cash_flow") && <section>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">{TABS.find((tab) => tab.id === activeTab)?.label}</h2><p className="mt-1 text-xs text-muted-foreground">Normalized stored financial periods; no estimated values</p></div>
            <div className="flex rounded border border-border bg-panel p-0.5">{(["annual", "quarterly"] as const).map((period) => <button key={period} type="button" onClick={() => setPeriodType(period)} className={`rounded px-3 py-1.5 text-xs capitalize ${periodType === period ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{period}</button>)}</div></div>
          <StatementTable statements={statements} tab={activeTab} reason={statementAvailability?.reason ?? "Statement unavailable from the verified stored source"} />
        </section>}

        {activeTab === "ratios" && <section><div className="mb-4"><h2 className="text-lg font-semibold">Verified ratios</h2><p className="mt-1 text-xs text-muted-foreground">Computed or sourced server-side; unavailable values remain blank.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{RATIO_FIELDS.map(([field, label, mode]) => {
            const value = detail.fundamentals?.[field];
            return <div key={field} className="rounded-lg border border-border bg-panel/40 p-4"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-2 font-mono text-lg font-semibold">{typeof value === "number" ? formatNumber(value, mode) : <Missing reason={`${label} unavailable: no defensible stored value`} />}</div></div>;
          })}</div>
          {!detail.fundamentals && <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">Fundamentals unavailable: Yahoo quoteSummary returned HTTP 401 during verification and no normalized database snapshot exists for this company.</div>}
        </section>}
      </main>
    </div>
  );
}
