import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Newspaper, ExternalLink, Clock, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Minus, Bookmark, Share2 } from "lucide-react";
import { DataBadge } from "@/components/common/data-badge";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/news")({
  head: () => ({ meta: [{ title: "News — MAET" }] }),
  component: News,
});

type Sentiment = "positive" | "negative" | "neutral";
type Category = "all" | "markets" | "economy" | "companies";

interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  time: string;
  timestamp: number;
  sentiment: Sentiment;
  category: Category;
  symbols: string[];
  readTime?: number;
}

const MOCK_NEWS: NewsItem[] = [
  {
    id: "1",
    source: "Economic Times",
    title: "RBI holds repo rate steady at 6.5%; markets react positively",
    summary: "The Reserve Bank of India maintained the repo rate at 6.5% in its latest monetary policy meeting, citing controlled inflation and stable growth outlook.",
    time: "2h ago",
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    sentiment: "positive",
    category: "economy",
    symbols: ["NIFTY", "BANKNIFTY"],
    readTime: 3,
  },
  {
    id: "2",
    source: "Bloomberg Quint",
    title: "Reliance Industries reports Q1 profit jump of 12% YoY",
    summary: "Reliance Industries' consolidated net profit rose to ₹19,641 crore in Q1 FY2026-27, beating street estimates of ₹18,500 crore. Revenue grew 8% YoY.",
    time: "4h ago",
    timestamp: Date.now() - 4 * 60 * 60 * 1000,
    sentiment: "positive",
    category: "companies",
    symbols: ["RELIANCE"],
    readTime: 5,
  },
  {
    id: "3",
    source: "Moneycontrol",
    title: "IT sector faces headwinds as global tech spending slows",
    summary: "Major IT services companies see order book declines as clients in North America cut discretionary spending. Sector down 3% this week.",
    time: "6h ago",
    timestamp: Date.now() - 6 * 60 * 60 * 1000,
    sentiment: "negative",
    category: "markets",
    symbols: ["TCS", "INFY", "WIPRO"],
    readTime: 4,
  },
  {
    id: "4",
    source: "Business Standard",
    title: "Nifty Bank index outperforms broader market; private lenders rally",
    summary: "Banking stocks led the gains today with HDFC Bank and ICICI Bank up 2%+ each on strong credit growth numbers and improving asset quality.",
    time: "8h ago",
    timestamp: Date.now() - 8 * 60 * 60 * 1000,
    sentiment: "positive",
    category: "markets",
    symbols: ["BANKNIFTY", "HDFCBANK", "ICICIBANK"],
    readTime: 4,
  },
  {
    id: "5",
    source: "LiveMint",
    title: "FIIs turn net buyers in June; domestic institutions continue selling",
    summary: "Foreign institutional investors bought ₹4,200 crore worth of Indian equities in the first three weeks of June, reversing three months of outflows.",
    time: "12h ago",
    timestamp: Date.now() - 12 * 60 * 60 * 1000,
    sentiment: "neutral",
    category: "markets",
    symbols: ["NIFTY"],
    readTime: 3,
  },
  {
    id: "6",
    source: "Financial Express",
    title: "Nifty 50 breaks above 24,000 resistance; technical analysts bullish",
    summary: "The Nifty 50 index broke above the key psychological level of 24,000 with strong volumes, signaling potential for further upside. MACD shows bullish crossover.",
    time: "1d ago",
    timestamp: Date.now() - 24 * 60 * 60 * 1000,
    sentiment: "positive",
    category: "markets",
    symbols: ["NIFTY", "NIFTY50"],
    readTime: 5,
  },
  {
    id: "7",
    source: "CNBC-TV18",
    title: "Crude oil prices drop 2% on demand concerns",
    summary: "Brent crude fell to $78.50 per barrel on concerns about slowing global demand, providing relief to import-dependent India.",
    time: "1d ago",
    timestamp: Date.now() - 28 * 60 * 60 * 1000,
    sentiment: "neutral",
    category: "economy",
    symbols: ["NIFTY", "BANKNIFTY"],
    readTime: 3,
  },
  {
    id: "8",
    source: "The Economic Times",
    title: "TCS announces ₹18,000 crore share buyback at ₹4,500/share",
    summary: "Tata Consultancy Services board approved a share buyback of up to 4 crore shares at a maximum price of ₹4,500 per share, representing 1.1% of equity.",
    time: "2d ago",
    timestamp: Date.now() - 48 * 60 * 60 * 1000,
    sentiment: "positive",
    category: "companies",
    symbols: ["TCS"],
    readTime: 4,
  },
];

const SENTIMENT_CONFIG: Record<Sentiment, { icon: typeof TrendingUp; color: string; bg: string; label: string }> = {
  positive: { icon: TrendingUp, color: "text-bull", bg: "bg-bull/10", label: "Bullish" },
  negative: { icon: TrendingDown, color: "text-bear", bg: "bg-bear/10", label: "Bearish" },
  neutral: { icon: Minus, color: "text-muted-foreground", bg: "bg-muted/10", label: "Neutral" },
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "All News" },
  { value: "markets", label: "Markets" },
  { value: "economy", label: "Economy" },
  { value: "companies", label: "Companies" },
];

function NewsCard({ item }: { item: NewsItem }) {
  const sentiment = SENTIMENT_CONFIG[item.sentiment];
  const SentimentIcon = sentiment.icon;

  return (
    <div className="px-6 py-5 hover:bg-accent/50 transition-colors group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {/* Meta */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="font-medium text-foreground">{item.source}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.time}
            </span>
            {item.readTime && (
              <>
                <span>·</span>
                <span>{item.readTime} min read</span>
              </>
            )}
            <span>·</span>
            <span className={`inline-flex items-center gap-1 ${sentiment.color}`}>
              <SentimentIcon className="h-3 w-3" />
              {sentiment.label}
            </span>
          </div>

          {/* Title */}
          <h3 className="mt-2 font-semibold leading-snug group-hover:text-primary transition-colors">
            {item.title}
          </h3>

          {/* Summary */}
          <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {item.summary}
          </p>

          {/* Symbols */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {item.symbols.map((sym) => (
              <span
                key={sym}
                className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 cursor-pointer transition-colors"
              >
                {sym}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Bookmark"
          >
            <Bookmark className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open link"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function News() {
  const [category, setCategory] = useState<Category>("all");
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | "all">("all");

  const filteredNews = useMemo(() => {
    let result = MOCK_NEWS;

    if (category !== "all") {
      result = result.filter(item => item.category === category);
    }

    if (sentimentFilter !== "all") {
      result = result.filter(item => item.sentiment === sentimentFilter);
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
  }, [category, sentimentFilter]);

  const sentimentCounts = useMemo(() => ({
    positive: MOCK_NEWS.filter(n => n.sentiment === "positive").length,
    negative: MOCK_NEWS.filter(n => n.sentiment === "negative").length,
    neutral: MOCK_NEWS.filter(n => n.sentiment === "neutral").length,
  }), []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Newspaper className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-xl font-semibold">News Feed</h1>
                <p className="text-xs text-muted-foreground">
                  {MOCK_NEWS.length} articles
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-bull">
                  <TrendingUp className="h-3 w-3" />
                  {sentimentCounts.positive}
                </span>
                <span className="flex items-center gap-1 text-bear">
                  <TrendingDown className="h-3 w-3" />
                  {sentimentCounts.negative}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Minus className="h-3 w-3" />
                  {sentimentCounts.neutral}
                </span>
              </div>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 mt-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  category === cat.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {cat.label}
              </button>
            ))}
            <div className="ml-auto flex gap-1">
              {(["all", "positive", "negative", "neutral"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSentimentFilter(s)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors capitalize ${
                    sentimentFilter === s
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* News list */}
      <div className="flex-1 overflow-auto">
        {filteredNews.length > 0 ? (
          <div className="divide-y divide-border bg-panel">
            {filteredNews.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No news articles match your filters
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel/50 p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="News feed provider pending — showing sample market headlines for UI demonstration" />
      </div>
    </div>
  );
}
