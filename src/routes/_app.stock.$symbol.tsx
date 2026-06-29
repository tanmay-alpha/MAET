import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart2, BookOpen, GitMerge, Layers, TrendingDown, TrendingUp, Users, Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { TiltCard } from "@/components/trading/tilt-card";
import { ContractPanel } from "@/components/common/contract-panel";
import { FinancialStatementsPanel } from "@/components/stock/financials-panel";
import { KeyRatiosPanel } from "@/components/stock/ratios-panel";
import { ShareholdingPanel } from "@/components/stock/shareholding-panel";
import { CorporateActionsPanel } from "@/components/stock/corporate-actions-panel";
import { PeerComparisonPanel } from "@/components/stock/peer-comparison-panel";
import type { MarketCandle } from "@/lib/market-api";

export const Route = createFileRoute("/_app/stock/$symbol")({
  head: () => ({
    meta: [{ title: "Stock Detail — MAET" }]
  }),
  component: StockDetail,
});

type StatementTab = "balance_sheet" | "pl" | "cashflow";
type DetailTab = "ratios" | "shareholding" | "actions" | "peers";

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const STATEMENT_TABS: { id: StatementTab; label: string }[] = [
  { id: "balance_sheet", label: "Balance Sheet" },
  { id: "pl", label: "P&L" },
  { id: "cashflow", label: "Cash Flow" },
];

const DETAIL_TABS: { id: DetailTab; label: string; icon: any }[] = [
  { id: "ratios", label: "Key Ratios", icon: Calculator },
  { id: "shareholding", label: "Shareholding", icon: Users },
  { id: "actions", label: "Corporate Actions", icon: GitMerge },
  { id: "peers", label: "Peer Comparison", icon: BarChart2 },
];

function StockDetail() {
  const { symbol } = Route.useParams();
  const navigate = useNavigate();
  const { quoteMap, streamConnected, isError: quoteError } = useMarketQuotes([symbol]);
  const liveQuote = quoteMap.get(symbol);
  const [activeStatement, setActiveStatement] = useState<StatementTab>("balance_sheet");
  const [activeDetail, setActiveDetail] = useState<DetailTab>("ratios");

  // Load candles for default chart
  const candleQuery = useMarketCandles(symbol, "5m", "1d");
  const candles = useMemo(
    () => (candleQuery.data?.candles ?? []).map((candle) => ({
      t: new Date(candle.ts).getTime(),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume,
    })),
    [candleQuery.data?.candles]
  );

  const currentPrice = liveQuote?.price;
  const previousClose = liveQuote?.previousClose;
  const dayChangePct = liveQuote?.changePct;
  const marketCap = previousClose ? (currentPrice || 0) * 100000000 : undefined;

  if (liveQuote === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <ContractPanel symbol={symbol} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <button
            onClick={() => navigate({ to: "/screener" })}
            className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Screener
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 space-y-8">
        {/* Symbol Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold">{symbol}</h1>
            <p className="text-muted-foreground">NSE · Equity</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-mono font-bold">{currentPrice?.toFixed(2) ?? "—"}</div>
            <div className={`font-mono text-lg ${dayChangePct !== undefined && dayChangePct >= 0 ? "text-bull" : "text-bear"}`}>
              {dayChangePct !== undefined
                ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%`
                : "Loading..."}
            </div>
            <div className="text-xs text-muted-foreground">
              {quoteError ? "Quote unavailable" : streamConnected ? "Yahoo delayed" : "Connecting"}
            </div>
          </div>
        </div>

        {/* Time periods */}
        <div className="flex gap-2">
          {["1m", "5m", "15m", "1h", "1D", "1W"].map((tf) => (
            <button
              key={tf}
              className="rounded border border-border bg-panel px-3 py-1 text-sm hover:bg-accent"
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Chart Area */}
          <div className="lg:col-span-2">
            <TiltCard max={10}>
              <div className="rounded-2xl border border-border bg-panel/95 p-4">
                <h3 className="text-lg font-semibold mb-4">Price Chart</h3>
                <div className="h-96 bg-panel rounded-lg border border-border flex items-center justify-center">
                  {candles.length > 1 ? (
                    <div className="text-center">
                      <div className="text-lg font-semibold mb-2">Chart Canvas</div>
                      <div className="text-sm text-muted-foreground">
                        Interactive chart with indicators, drawing tools
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-lg font-semibold mb-2">Loading...</div>
                      <div className="text-sm text-muted-foreground">
                        {candleQuery.isError ? "Candle data unavailable" : "Loading Yahoo data..."}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TiltCard>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quote Info */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Quote Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open</span>
                    <span className="font-mono">{liveQuote?.price?.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">High</span>
                    <span className="font-mono text-bull">{liveQuote?.price?.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Low</span>
                    <span className="font-mono text-bear">{liveQuote?.price?.toFixed(2) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span className="font-mono">{liveQuote?.volume?.toLocaleString() || "—"}</span>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Key Stats */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Key Statistics</h3>
                <div className="space-y-3">
                  <StatCard
                    icon={Layers}
                    label="Market Cap"
                    value={marketCap ? `₹${(marketCap / 10000000).toFixed(1)}Cr` : "—"}
                  />
                  <StatCard
                    icon={TrendingUp}
                    label="52W High"
                    value="—"
                    sub="Yahoo data only"
                  />
                  <StatCard
                    icon={TrendingDown}
                    label="52W Low"
                    value="—"
                    sub="Yahoo data only"
                  />
                  <StatCard
                    icon={Calculator}
                    label="P/E Ratio"
                    value="—"
                    sub="Fundamentals pending"
                  />
                </div>
              </div>
            </TiltCard>

            {/* News */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Recent News</h3>
                <div className="text-center py-8 text-muted-foreground">
                  Market news feed integration pending
                </div>
              </div>
            </TiltCard>
          </div>
        </div>

        {/* Financial Statements */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Financial Statements
          </h2>
          <TiltCard>
            <div className="rounded-xl border border-border bg-panel p-4">
              <div className="mb-4 flex gap-2 border-b border-border pb-3">
                {STATEMENT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveStatement(tab.id)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      activeStatement === tab.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent hover:bg-accent/80"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <FinancialStatementsPanel symbol={symbol} active={activeStatement} />
            </div>
          </TiltCard>
        </div>

        {/* Key Ratios */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Key Ratios
          </h2>
          <KeyRatiosPanel symbol={symbol} />
        </div>

        {/* Shareholding + Corporate Actions side by side */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Shareholding Pattern
            </h2>
            <ShareholdingPanel symbol={symbol} />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              Corporate Actions
            </h2>
            <CorporateActionsPanel symbol={symbol} />
          </div>
        </div>

        {/* Peer Comparison */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <BarChart2 className="h-5 w-5" />
            Sector Peer Comparison
          </h2>
          <TiltCard>
            <div className="rounded-xl border border-border bg-panel p-4">
              <PeerComparisonPanel symbol={symbol} />
            </div>
          </TiltCard>
        </div>

        {/* Similar Stocks */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Similar Stocks</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {["TCS", "INFY", "HCLTECH", "TECHM"].map((ticker) => (
              <button
                key={ticker}
                className="rounded-lg border border-border bg-panel p-3 hover:bg-accent transition-colors"
                onClick={() => navigate({ to: `/stock/${ticker}` })}
              >
                <div className="font-semibold">{ticker}</div>
                <div className="text-sm text-muted-foreground mt-1">Sector Peer</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}