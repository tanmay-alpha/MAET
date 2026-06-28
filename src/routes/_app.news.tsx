import { createFileRoute } from "@tanstack/react-router";
import { Newspaper, ExternalLink, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { DataBadge } from "@/components/common/data-badge";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/news")({
  head: () => ({ meta: [{ title: "News — MAET" }] }),
  component: News,
});

const MOCK_NEWS = [
  {
    id: "1",
    source: "Economic Times",
    title: "RBI holds repo rate steady at 6.5%; markets react positively",
    summary: "The Reserve Bank of India maintained the repo rate at 6.5% in its latest monetary policy meeting, citing controlled inflation.",
    time: "2h ago",
    sentiment: "positive",
    symbols: ["NIFTY", "BANKNIFTY"],
  },
  {
    id: "2",
    source: "Bloomberg Quint",
    title: "Reliance Industries reports Q1 profit jump of 12% YoY",
    summary: "Reliance Industries' consolidated net profit rose to ₹19,641 crore in Q1 FY2026-27, beating street estimates.",
    time: "4h ago",
    sentiment: "positive",
    symbols: ["RELIANCE"],
  },
  {
    id: "3",
    source: "Moneycontrol",
    title: "IT sector faces headwinds as global tech spending slows",
    summary: "Major IT services companies see order book declines as clients in North America cut discretionary spending.",
    time: "6h ago",
    sentiment: "negative",
    symbols: ["TCS", "INFY", "WIPRO"],
  },
  {
    id: "4",
    source: "Business Standard",
    title: "Nifty Bank index outperforms broader market; private lenders rally",
    summary: "Banking stocks led the gains today with HDFC Bank and ICICI Bank up 2%+ each on strong credit growth numbers.",
    time: "8h ago",
    sentiment: "positive",
    symbols: ["BANKNIFTY", "HDFCBANK", "ICICIBANK"],
  },
  {
    id: "5",
    source: "LiveMint",
    title: "FIIs turn net buyers in June; domestic institutions continue selling",
    summary: "Foreign institutional investors bought ₹4,200 crore worth of Indian equities in the first three weeks of June.",
    time: "12h ago",
    sentiment: "neutral",
    symbols: ["NIFTY"],
  },
];

function News() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Newspaper className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">News Feed</h1>
        </div>
        <div className="flex gap-1 text-xs">
          <button className="rounded-md bg-accent px-2.5 py-1 text-foreground">All</button>
          <button className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground">Markets</button>
          <button className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground">Economy</button>
          <button className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground">Companies</button>
        </div>
      </div>

      {/* News list */}
      <div className="flex-1 overflow-auto">
        <div className="divide-y divide-border">
          {MOCK_NEWS.map((item) => (
            <div key={item.id} className="px-5 py-4 hover:bg-accent/50 transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{item.source}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.time}
                    </span>
                    <span>·</span>
                    <span className={`flex items-center gap-1 ${
                      item.sentiment === "positive" ? "text-bull" : item.sentiment === "negative" ? "text-bear" : "text-muted-foreground"
                    }`}>
                      {item.sentiment === "positive" ? <TrendingUp className="h-3 w-3" /> : item.sentiment === "negative" ? <TrendingDown className="h-3 w-3" /> : null}
                      {item.sentiment}
                    </span>
                  </div>

                  <h3 className="mt-1.5 font-semibold leading-snug">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.summary}</p>

                  <div className="mt-2 flex items-center gap-2">
                    {item.symbols.map((sym) => (
                      <span key={sym} className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {sym}
                      </span>
                    ))}
                  </div>
                </div>

                <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground shrink-0">
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="News feed provider pending — showing sample market headlines for UI demonstration" />
      </div>
    </div>
  );
}
