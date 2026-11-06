import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/_app/news")({
  head: () => ({ meta: [{ title: "News (samples) — MAET" }] }),
  component: News,
});

type Category = "all" | "markets" | "economy" | "companies";

/**
 * No news provider is connected. These are layout placeholders: topics only, with no
 * outlet, date, figure or sentiment attached, so nothing here can be mistaken for a report.
 */
interface SampleHeadline {
  id: string;
  title: string;
  summary: string;
  category: Exclude<Category, "all">;
  symbols: string[];
}

const SAMPLE_HEADLINES: SampleHeadline[] = [
  {
    id: "policy",
    title: "RBI policy decision and the market reaction",
    summary: "A policy-day story would cover the rate decision, the inflation outlook and how banks and rate-sensitive stocks moved.",
    category: "economy",
    symbols: ["BANKNIFTY"],
  },
  {
    id: "results",
    title: "Quarterly results: Reliance Industries",
    summary: "An earnings story would compare revenue, profit and margins with the previous quarter and show the stock's reaction.",
    category: "companies",
    symbols: ["RELIANCE"],
  },
  {
    id: "it-services",
    title: "IT services stocks and US technology spending",
    summary: "A sector story would link client spending commentary to order books at the large IT services companies.",
    category: "markets",
    symbols: ["TCS", "INFY", "WIPRO"],
  },
  {
    id: "private-banks",
    title: "Private bank stocks against the broader index",
    summary: "A market story would compare the private lenders' moves with the NIFTY 50 and explain the drivers.",
    category: "markets",
    symbols: ["HDFCBANK", "ICICIBANK"],
  },
  {
    id: "flows",
    title: "Foreign and domestic institutional flows",
    summary: "A flows story would report net buying and selling by FIIs and DIIs from the exchange's provisional data.",
    category: "markets",
    symbols: ["NIFTY"],
  },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "markets", label: "Markets" },
  { value: "economy", label: "Economy" },
  { value: "companies", label: "Companies" },
];

function News() {
  const [category, setCategory] = useState<Category>("all");
  const headlines = category === "all" ? SAMPLE_HEADLINES : SAMPLE_HEADLINES.filter((item) => item.category === category);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">News</h1>
        <div className="flex flex-wrap gap-1 sm:ml-auto" role="group" aria-label="Category">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              aria-pressed={category === cat.value}
              onClick={() => setCategory(cat.value)}
              className={`shrink-0 rounded border px-2.5 py-1 text-xs transition-colors ${
                category === cat.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-3 p-4 sm:p-5">
        <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          Sample headlines: no live news feed connected. The items below are placeholders that show the layout; they are not news.
        </p>

        <ul className="space-y-2" aria-label="Sample headlines">
          {headlines.map((item) => (
            <li key={item.id} className="rounded border border-dashed border-border px-3 py-2.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="font-mono text-amber-400/80">Sample</span>
                <span>{item.category}</span>
              </div>
              <h2 className="mt-1 text-sm font-medium text-muted-foreground">{item.title}</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/80">{item.summary}</p>
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{item.symbols.join(" · ")}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
