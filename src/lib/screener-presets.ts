import type { MarketCompany, MarketQuote } from "@/lib/market-api";

export type ScreenerFilters = Record<string, string>;
export type ScreenerSortDirection = "asc" | "desc";
export type ScreenerSort = { sortBy: string; sortDir: ScreenerSortDirection };

export const DEFAULT_SCREENER_SORT: ScreenerSort = { sortBy: "symbol", sortDir: "asc" };

export type ScreenerPreset = {
  id: string;
  label: string;
  title: string;
  filters: ScreenerFilters;
  /** Sort the preset applies; presets without one keep the current sort. */
  sort?: ScreenerSort;
  /** `fieldAvailability` keys the preset needs from the companies response. */
  requires?: readonly string[];
};

export const SCREENER_PRESETS: readonly ScreenerPreset[] = [
  { id: "all", label: "All stocks", title: "Show the full available NSE company universe", filters: {}, sort: DEFAULT_SCREENER_SORT },
  { id: "gainers", label: "Gainers", title: "Up on the day, biggest change first", filters: { change_pct_min: "0.01" }, sort: { sortBy: "change_pct", sortDir: "desc" } },
  { id: "losers", label: "Losers", title: "Down on the day, biggest fall first", filters: { change_pct_max: "-0.01" }, sort: { sortBy: "change_pct", sortDir: "asc" } },
  { id: "high-volume", label: "High volume", title: "Volume above 10 lakh shares today", filters: { volume_min: "1000000" } },
  { id: "price-1000", label: "Price above 1000", title: "Trading above ₹1,000", filters: { price_min: "1000" } },
  { id: "active", label: "Active movers", title: "Up more than 1% in the latest quote", filters: { change_pct_min: "1" } },
  { id: "oversold", label: "RSI Oversold", title: "Wilder's RSI(14) at or below 30", filters: { rsi_max: "30" }, requires: ["rsi"] },
  { id: "overbought", label: "RSI Overbought", title: "Wilder's RSI(14) at or above 70", filters: { rsi_min: "70" }, requires: ["rsi"] },
  { id: "above-200sma", label: "Above 200 SMA", title: "Price above the 200-day simple moving average", filters: { price_above_sma200: "true" }, requires: ["sma200"] },
  { id: "golden-cross", label: "Golden Cross", title: "50-day moving average above the 200-day moving average", filters: { golden_cross: "true" }, requires: ["sma50", "sma200"] },
  { id: "large", label: "Large cap", title: "Market-cap rank 1–100", filters: { bucket_in: "large" }, requires: ["marketCap"] },
  { id: "mid", label: "Mid cap", title: "Market-cap rank 101–250", filters: { bucket_in: "mid" }, requires: ["marketCap"] },
  { id: "small", label: "Small cap", title: "Market-cap rank 251 and below", filters: { bucket_in: "small" }, requires: ["marketCap"] },
  { id: "value", label: "Deep value", title: "P/E below 20 and P/B below 3", filters: { pe_max: "20", pb_max: "3" }, requires: ["pe", "pb"] },
  { id: "roe", label: "High ROE", title: "Return on equity above 15%", filters: { roe_min: "15" }, requires: ["roe"] },
  // Percentage points, like every other percent filter: the server divides bounds by 100.
  { id: "dividend", label: "High dividend", title: "Dividend yield above 1%", filters: { dividend_yield_min: "1" }, requires: ["dividendYield"] },
];

function activeEntries(filters: ScreenerFilters): Array<[string, string]> {
  return Object.entries(filters)
    .map(([key, value]): [string, string] => [key, value.trim()])
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function applyScreenerPreset(
  id: string,
  current: ScreenerSort,
): { filters: ScreenerFilters; sort: ScreenerSort } {
  const preset = SCREENER_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown screener preset: ${id}`);
  return { filters: { ...preset.filters }, sort: preset.sort ?? current };
}

/** The preset whose filters equal the current ones (blank inputs ignored), if any. */
export function activeScreenerPreset(filters: ScreenerFilters): string | null {
  const key = JSON.stringify(activeEntries(filters));
  return SCREENER_PRESETS.find((preset) => JSON.stringify(activeEntries(preset.filters)) === key)?.id ?? null;
}

/** Sort keys (and `<key>_min` / `<key>_max` filters) the page can answer from live quotes. */
const LIVE_QUOTE_FIELDS = {
  price: "price",
  change_pct: "changePct",
  volume: "volume",
} as const satisfies Record<string, keyof MarketQuote & keyof MarketCompany>;

type LiveQuoteKey = keyof typeof LIVE_QUOTE_FIELDS;
const LIVE_QUOTE_KEYS = Object.keys(LIVE_QUOTE_FIELDS) as LiveQuoteKey[];

export const LIVE_QUOTE_FILTER_KEYS: ReadonlySet<string> = new Set(
  LIVE_QUOTE_KEYS.flatMap((key) => [`${key}_min`, `${key}_max`]),
);

function isLiveQuoteKey(key: string): key is LiveQuoteKey {
  return Object.hasOwn(LIVE_QUOTE_FIELDS, key);
}

/** The value the row displays: the live quote when there is one, else the stored snapshot. */
function displayedValue(company: MarketCompany, quote: MarketQuote | undefined, key: LiveQuoteKey): number | undefined {
  const field = LIVE_QUOTE_FIELDS[key];
  return quote?.[field] ?? company[field];
}

/**
 * Arranges one loaded page by the quote values its rows display.
 *
 * - `filterLive`: apply price / change / volume filters here. The NSE fallback (database
 *   down) has no stored quotes, so the server cannot evaluate them.
 * - Price / change / volume sorts are re-applied with the displayed live values, so the
 *   column reads in order even where the server had no (or an older) snapshot. Missing
 *   values go last and ties fall back to the symbol, as on the server.
 */
export function arrangeLivePage(
  companies: readonly MarketCompany[],
  quotes: ReadonlyMap<string, MarketQuote>,
  options: { filters: ScreenerFilters; sort: ScreenerSort; filterLive: boolean },
): MarketCompany[] {
  const { filters, sort, filterLive } = options;
  const rows = filterLive
    ? companies.filter((company) => {
        const quote = quotes.get(company.symbol);
        return LIVE_QUOTE_KEYS.every((key) => {
          const value = displayedValue(company, quote, key);
          const min = filters[`${key}_min`]?.trim();
          const max = filters[`${key}_max`]?.trim();
          if (min && (value === undefined || value < Number(min))) return false;
          if (max && (value === undefined || value > Number(max))) return false;
          return true;
        });
      })
    : [...companies];
  const { sortBy, sortDir } = sort;
  if (!isLiveQuoteKey(sortBy)) return rows;
  const direction = sortDir === "desc" ? -1 : 1;
  const value = (company: MarketCompany) => displayedValue(company, quotes.get(company.symbol), sortBy);
  return rows.sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a === undefined || b === undefined) {
      if (a !== b) return a === undefined ? 1 : -1;
      return left.symbol.localeCompare(right.symbol);
    }
    return (a - b) * direction || left.symbol.localeCompare(right.symbol);
  });
}
