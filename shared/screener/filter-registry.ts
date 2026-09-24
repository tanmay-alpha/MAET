/**
 * Centralized Screener Filter Metadata Registry
 * Defines all filterable metrics across fundamentals, valuation, market structure, and technical indicators.
 */

export type FilterCategory =
  | "price_volume"
  | "valuation"
  | "profitability"
  | "financials"
  | "balance_sheet"
  | "technicals";

export type FilterType = "numeric_range" | "boolean" | "select";

export interface FilterDefinition {
  id: string;
  label: string;
  category: FilterCategory;
  type: FilterType;
  unit?: string;
  minKey?: string;
  maxKey?: string;
  boolKey?: string;
  description: string;
  step?: number;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
}

export const SCREENER_FILTER_DEFINITIONS: FilterDefinition[] = [
  // Price & Volume
  {
    id: "price",
    label: "Price (₹)",
    category: "price_volume",
    type: "numeric_range",
    unit: "₹",
    minKey: "price_min",
    maxKey: "price_max",
    description: "Latest traded price in INR",
    step: 1,
  },
  {
    id: "change_pct",
    label: "Price Change (%)",
    category: "price_volume",
    type: "numeric_range",
    unit: "%",
    minKey: "change_pct_min",
    maxKey: "change_pct_max",
    description: "Daily price change percentage",
    step: 0.1,
  },
  {
    id: "volume",
    label: "Volume",
    category: "price_volume",
    type: "numeric_range",
    minKey: "volume_min",
    maxKey: "volume_max",
    description: "Latest traded volume (shares)",
    step: 1000,
  },
  {
    id: "rel_volume",
    label: "Relative Volume (20D)",
    category: "price_volume",
    type: "numeric_range",
    unit: "x",
    minKey: "rel_volume_min",
    maxKey: "rel_volume_max",
    description: "Ratio of current volume to 20-day average volume",
    step: 0.1,
  },

  // Technical Indicators
  {
    id: "rsi14",
    label: "RSI (14)",
    category: "technicals",
    type: "numeric_range",
    minKey: "rsi_min",
    maxKey: "rsi_max",
    description: "Wilder's 14-period Relative Strength Index (0-100)",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    id: "distance_sma200",
    label: "Distance from SMA 200 (%)",
    category: "technicals",
    type: "numeric_range",
    unit: "%",
    minKey: "distance_sma200_min",
    maxKey: "distance_sma200_max",
    description: "Percentage distance of current price from 200-day simple moving average",
    step: 0.5,
  },
  {
    id: "distance_52w_high",
    label: "Distance from 52W High (%)",
    category: "technicals",
    type: "numeric_range",
    unit: "%",
    minKey: "distance_52w_high_min",
    maxKey: "distance_52w_high_max",
    description: "Percentage distance below the 52-week high (<= 0%)",
    step: 0.5,
  },
  {
    id: "atr14",
    label: "ATR (14)",
    category: "technicals",
    type: "numeric_range",
    unit: "₹",
    minKey: "atr_min",
    maxKey: "atr_max",
    description: "14-day Average True Range in INR",
    step: 0.5,
  },
  {
    id: "price_above_sma200",
    label: "Price > 200 SMA",
    category: "technicals",
    type: "boolean",
    boolKey: "price_above_sma200",
    description: "Only include stocks trading above their 200-day moving average",
  },
  {
    id: "price_above_sma50",
    label: "Price > 50 SMA",
    category: "technicals",
    type: "boolean",
    boolKey: "price_above_sma50",
    description: "Only include stocks trading above their 50-day moving average",
  },
  {
    id: "golden_cross",
    label: "Golden Cross (SMA 50 > 200)",
    category: "technicals",
    type: "boolean",
    boolKey: "golden_cross",
    description: "Stocks where 50 SMA is above 200 SMA",
  },
  {
    id: "rsi_oversold",
    label: "RSI Oversold (<= 30)",
    category: "technicals",
    type: "boolean",
    boolKey: "rsi_oversold",
    description: "Stocks with RSI(14) at or below 30",
  },
  {
    id: "rsi_overbought",
    label: "RSI Overbought (>= 70)",
    category: "technicals",
    type: "boolean",
    boolKey: "rsi_overbought",
    description: "Stocks with RSI(14) at or above 70",
  },
  {
    id: "high_breakout",
    label: "52-Week High Breakout",
    category: "technicals",
    type: "boolean",
    boolKey: "fifty_two_week_high_breakout",
    description: "Stocks trading at or above their 52-week high",
  },
  {
    id: "low_near",
    label: "Near 52-Week Low (Within 5%)",
    category: "technicals",
    type: "boolean",
    boolKey: "fifty_two_week_low_near",
    description: "Stocks trading within 5% of their 52-week low",
  },
  {
    id: "supertrend_bullish",
    label: "SuperTrend Bullish (Price > ST)",
    category: "technicals",
    type: "boolean",
    boolKey: "supertrend_bullish",
    description: "Stocks where current price is trading above the canonical SuperTrend line",
  },
  {
    id: "supertrend_bearish",
    label: "SuperTrend Bearish (Price < ST)",
    category: "technicals",
    type: "boolean",
    boolKey: "supertrend_bearish",
    description: "Stocks where current price is trading below the canonical SuperTrend line",
  },

  // Valuation
  {
    id: "market_cap",
    label: "Market Cap (₹ Cr)",
    category: "valuation",
    type: "numeric_range",
    unit: "Cr",
    minKey: "market_cap_min",
    maxKey: "market_cap_max",
    description: "Market capitalization in Crores",
    step: 100,
  },
  {
    id: "pe",
    label: "P/E Ratio",
    category: "valuation",
    type: "numeric_range",
    unit: "x",
    minKey: "pe_min",
    maxKey: "pe_max",
    description: "Price to Earnings ratio",
    step: 1,
  },
  {
    id: "pb",
    label: "P/B Ratio",
    category: "valuation",
    type: "numeric_range",
    unit: "x",
    minKey: "pb_min",
    maxKey: "pb_max",
    description: "Price to Book value ratio",
    step: 0.1,
  },
  {
    id: "dividend_yield",
    label: "Dividend Yield (%)",
    category: "valuation",
    type: "numeric_range",
    unit: "%",
    minKey: "dividend_yield_min",
    maxKey: "dividend_yield_max",
    description: "Annual dividend yield percentage",
    step: 0.1,
  },

  // Profitability
  {
    id: "roe",
    label: "ROE (%)",
    category: "profitability",
    type: "numeric_range",
    unit: "%",
    minKey: "roe_min",
    maxKey: "roe_max",
    description: "Return on Equity percentage",
    step: 1,
  },
  {
    id: "roce",
    label: "ROCE (%)",
    category: "profitability",
    type: "numeric_range",
    unit: "%",
    minKey: "roce_min",
    maxKey: "roce_max",
    description: "Return on Capital Employed percentage",
    step: 1,
  },

  // Balance Sheet & Growth
  {
    id: "debt_to_equity",
    label: "Debt / Equity (Max)",
    category: "balance_sheet",
    type: "numeric_range",
    unit: "ratio",
    maxKey: "debt_to_equity_max",
    description: "Total debt divided by shareholders equity",
    step: 0.1,
  },
  {
    id: "current_ratio",
    label: "Current Ratio (Min)",
    category: "balance_sheet",
    type: "numeric_range",
    unit: "ratio",
    minKey: "current_ratio_min",
    description: "Current assets divided by current liabilities",
    step: 0.1,
  },
  {
    id: "sales_growth",
    label: "Sales Growth (%) (Min)",
    category: "financials",
    type: "numeric_range",
    unit: "%",
    minKey: "sales_growth_min",
    description: "Year-over-year revenue growth percentage",
    step: 1,
  },
  {
    id: "profit_growth",
    label: "Profit Growth (%) (Min)",
    category: "financials",
    type: "numeric_range",
    unit: "%",
    minKey: "profit_growth_min",
    description: "Year-over-year net income growth percentage",
    step: 1,
  },
];
