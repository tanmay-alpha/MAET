export type Category = "all" | "markets" | "economy" | "companies";

/**
 * No news provider is connected. These are layout placeholders: topics only, with no
 * outlet, date, figure or sentiment attached, so nothing here can be mistaken for a report.
 */
export interface SampleHeadline {
  id: string;
  title: string;
  summary: string;
  category: Exclude<Category, "all">;
  symbols: string[];
}

export const SAMPLE_HEADLINES: SampleHeadline[] = [
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

export function headlinesFor(category: Category): SampleHeadline[] {
  return category === "all" ? SAMPLE_HEADLINES : SAMPLE_HEADLINES.filter((item) => item.category === category);
}
