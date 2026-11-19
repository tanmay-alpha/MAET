import { formatIst } from "@/components/data-quality/badges";
import type { MarketCompany, MarketQuote, MissingDataExclusions } from "@/lib/market-api";
import { quoteSourceLabel, sourceName } from "@/lib/quote-source";

/**
 * The unit of a screener column. Headers state it; cells show bare numbers in Indian
 * grouping, so one column never mixes rupees and crores.
 * - `inr`: rupees per share (price, EPS, SMA, ATR).
 * - `inrCr`: rupee crores (market cap, revenue, net income); the value arrives in rupees.
 * - `percent`: a stored decimal fraction (0.18 is 18%), as ROE and yields are stored.
 * - `percentPoints`: already in percent (2.4 is 2.4%), as day change and distances are.
 * - `multiple`: a ratio such as P/E or debt/equity.
 */
export type MetricUnit = "inr" | "inrCr" | "percent" | "percentPoints" | "multiple" | "shares" | "index";

export const UNIT_LABEL: Record<MetricUnit, string> = {
  inr: "₹",
  inrCr: "₹ Cr",
  percent: "%",
  percentPoints: "%",
  multiple: "x",
  shares: "shares",
  index: "0–100",
};

const CRORE = 10_000_000;
const FRACTION_DIGITS: Record<MetricUnit, number> = {
  inr: 2,
  inrCr: 2,
  percent: 2,
  percentPoints: 2,
  multiple: 2,
  shares: 0,
  index: 1,
};

/** A displayable metric is a finite number; null, undefined, NaN and ±Infinity are missing data, never 0. */
export function isAvailableMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The value in its column unit with Indian digit grouping ("12,34,567.80"), or null when the
 * metric is missing. `signed` prefixes positive values with "+"; values that round to zero
 * carry no sign.
 */
export function formatMetric(
  value: number | null | undefined,
  unit: MetricUnit,
  options: { signed?: boolean } = {},
): string | null {
  if (!isAvailableMetric(value)) return null;
  const scaled = unit === "inrCr" ? value / CRORE : unit === "percent" ? value * 100 : value;
  const digits = FRACTION_DIGITS[unit];
  const factor = 10 ** digits;
  // `|| 0` turns -0 into 0, so -0.001 reads "0.00" rather than "-0.00".
  const rounded = Math.round(scaled * factor) / factor || 0;
  const text = rounded.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return options.signed && rounded > 0 ? `+${text}` : text;
}

/** Display names of the `fieldAvailability` keys the server reports missing-data exclusions under. */
export const METRIC_LABELS: Record<string, string> = {
  price: "Price",
  changePct: "Change",
  volume: "Volume",
  relVolume: "Rel volume",
  marketCap: "Market cap",
  pe: "P/E",
  pb: "P/B",
  roe: "ROE",
  roce: "ROCE",
  dividendYield: "Dividend yield",
  debtToEquity: "Debt / equity",
  currentRatio: "Current ratio",
  salesGrowth: "Sales growth",
  profitGrowth: "Profit growth",
  sector: "Sector",
  industry: "Industry",
  fiftyTwoWeekHigh: "52W high",
  fiftyTwoWeekLow: "52W low",
  rsi: "RSI (14)",
  sma50: "SMA 50",
  sma200: "SMA 200",
  atr: "ATR (14)",
};

/** Adds two exclusion reports, e.g. the server's and the live-quote filter's. */
export function mergeMissingExclusions(...reports: MissingDataExclusions[]): MissingDataExclusions {
  const byField: Record<string, number> = {};
  let total = 0;
  for (const report of reports) {
    total += report.total;
    for (const [field, count] of Object.entries(report.byField)) byField[field] = (byField[field] ?? 0) + count;
  }
  return { total, byField };
}

/**
 * "3 rows excluded for missing data (P/E 2, ROE 1)", or null when no row was excluded. Fields
 * are listed most-affected first; a row missing two metrics counts under each.
 */
export function describeMissingExclusions(report: MissingDataExclusions): string | null {
  if (report.total <= 0) return null;
  const fields = Object.entries(report.byField)
    .filter(([, count]) => count > 0)
    .sort(([leftField, left], [rightField, right]) => right - left || leftField.localeCompare(rightField))
    .map(([field, count]) => `${METRIC_LABELS[field] ?? field} ${count.toLocaleString("en-IN")}`);
  const rows = `${report.total.toLocaleString("en-IN")} ${report.total === 1 ? "row" : "rows"} excluded for missing data`;
  return fields.length > 0 ? `${rows} (${fields.join(", ")})` : rows;
}

/** Older than this, a price is flagged stale: it outlasts a weekend plus a market holiday. */
export const PRICE_STALE_AFTER_MS = 4 * 86_400_000;

export type Provenance = {
  /** Display name of the source, or null when the source was not recorded. */
  source: string | null;
  asOf: string | null;
  stale: boolean;
};

/** "NSE + Angel One + yahoo_candles" for a composite stored source. */
export function sourceLabel(source: string): string {
  return source.split("+").map((part) => sourceName(part.trim())).join(" + ");
}

function isOlderThan(iso: string, limitMs: number, now: number): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && now - time > limitMs;
}

/** Where the row's displayed price came from: the live quote when there is one, else the stored snapshot. */
export function priceProvenance(company: MarketCompany, quote: MarketQuote | undefined, now: number): Provenance | null {
  if (quote) {
    return {
      source: quoteSourceLabel(quote.source, quote.delayed),
      asOf: quote.ts,
      stale: isOlderThan(quote.ts, PRICE_STALE_AFTER_MS, now),
    };
  }
  if (!isAvailableMetric(company.price)) return null;
  return {
    source: company.quoteSource ? sourceLabel(company.quoteSource) : null,
    asOf: company.quoteAsOf ?? null,
    stale: company.quoteAsOf ? isOlderThan(company.quoteAsOf, PRICE_STALE_AFTER_MS, now) : false,
  };
}

/** Where the row's fundamentals came from; staleness is the server's judgement. */
export function fundamentalsProvenance(company: MarketCompany): Provenance | null {
  if (!company.fundamentalsSource && !company.fundamentalsAsOf) return null;
  return {
    source: company.fundamentalsSource ? sourceLabel(company.fundamentalsSource) : null,
    asOf: company.fundamentalsAsOf ?? null,
    stale: company.staleFundamentals === true,
  };
}

const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export type ProvenanceKind = "price" | "fundamentals";

/**
 * "Angel One · live · 06 Nov, 15:45 IST" for a price, "Yahoo Finance · quote summary ·
 * 30 Sep 2026" for fundamentals (a period or update date, so no time of day).
 */
export function describeProvenance(provenance: Provenance | null, kind: ProvenanceKind): string {
  if (!provenance) return "not available";
  const source = provenance.source ?? "source not recorded";
  const asOf = provenance.asOf
    ? kind === "price"
      ? formatIst(provenance.asOf)
      : IST_DATE.format(new Date(provenance.asOf))
    : "as-of time not recorded";
  return `${source} · ${asOf}`;
}

/**
 * The provenance every row shares, as displayed, or "mixed" when rows differ (in source, the
 * displayed time, staleness or availability). An empty page is uniform with nothing to show.
 */
export function uniformProvenance(
  provenances: ReadonlyArray<Provenance | null>,
  kind: ProvenanceKind,
): { uniform: true; provenance: Provenance | null } | { uniform: false } {
  const [first] = provenances;
  if (first === undefined) return { uniform: true, provenance: null };
  const key = (provenance: Provenance | null) => `${describeProvenance(provenance, kind)}|${provenance?.stale ?? ""}`;
  const firstKey = key(first);
  return provenances.every((provenance) => key(provenance) === firstKey)
    ? { uniform: true, provenance: first }
    : { uniform: false };
}
