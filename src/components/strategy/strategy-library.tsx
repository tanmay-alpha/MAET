/**
 * Strategy Library — 7 built-in educational strategy templates.
 * No claimed returns. No synthetic profitability. Educational descriptions only.
 */

import type { StrategyDefinition } from "@shared/strategy/ast";

export interface StrategyTemplate {
  id: string;
  name: string;
  category: "trend_following" | "mean_reversion" | "momentum" | "breakout" | "volatility";
  description: string;
  hypothesis: string;
  limitations: string;
  timeframes: string[];
  /** The template's rules; templateCreateInput() adds the universe, risk and execution defaults. */
  definition: Pick<StrategyDefinition, "direction" | "timeframe" | "entry" | "exit">;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "sma_cross",
    name: "SMA Crossover",
    category: "trend_following",
    description: "Enter when fast SMA crosses above slow SMA. Exit when fast crosses below slow.",
    hypothesis: "A faster moving average crossing above a slower one suggests short-term momentum has turned bullish relative to longer-term trend.",
    limitations: "Prone to whipsaws in choppy, sideways markets. Best suited to strong trending environments.",
    timeframes: ["1d", "1w"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "sma_cross_above",
          left: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
          operator: "CROSS_ABOVE",
          right: { kind: "INDICATOR", indicator: "SMA", params: { period: 50 } },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "sma_cross_below",
          left: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
          operator: "CROSS_BELOW",
          right: { kind: "INDICATOR", indicator: "SMA", params: { period: 50 } },
        }],
      },
    },
  },
  {
    id: "ema_cross",
    name: "EMA Crossover",
    category: "trend_following",
    description: "Similar to SMA crossover but using exponential moving averages which react faster to price changes.",
    hypothesis: "EMA gives more weight to recent prices, potentially generating earlier signals than SMA cross.",
    limitations: "More sensitive to noise than SMA cross. May generate false signals in ranging markets.",
    timeframes: ["5m", "15m", "1h", "1d"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "ema_cross_above",
          left: { kind: "INDICATOR", indicator: "EMA", params: { period: 9 } },
          operator: "CROSS_ABOVE",
          right: { kind: "INDICATOR", indicator: "EMA", params: { period: 21 } },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "ema_cross_below",
          left: { kind: "INDICATOR", indicator: "EMA", params: { period: 9 } },
          operator: "CROSS_BELOW",
          right: { kind: "INDICATOR", indicator: "EMA", params: { period: 21 } },
        }],
      },
    },
  },
  {
    id: "rsi_reversal",
    name: "RSI Mean Reversion",
    category: "mean_reversion",
    description: "Enter long when RSI recovers above oversold threshold. Exit when RSI reaches overbought.",
    hypothesis: "Extreme RSI readings suggest potential exhaustion of the prevailing move, creating a reversion opportunity.",
    limitations: "In strong trends, RSI can remain oversold/overbought for extended periods. Not suitable for trending markets.",
    timeframes: ["1d", "1w"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "rsi_oversold_exit",
          left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 } },
          operator: "CROSS_ABOVE",
          right: { kind: "CONSTANT", value: 30 },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "rsi_overbought",
          left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 } },
          operator: "CROSS_ABOVE",
          right: { kind: "CONSTANT", value: 70 },
        }],
      },
    },
  },
  {
    id: "macd_cross",
    name: "MACD Signal Cross",
    category: "momentum",
    description: "Enter when MACD line crosses above signal line. Exit when MACD crosses below signal.",
    hypothesis: "MACD crossovers reflect momentum shifts — a bullish cross suggests increasing upward momentum.",
    limitations: "Lag is inherent. Works best in trending markets. Generates many false signals in sideways action.",
    timeframes: ["1d", "1w"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "macd_cross_above_signal",
          left: { kind: "INDICATOR", indicator: "MACD_LINE", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
          operator: "CROSS_ABOVE",
          right: { kind: "INDICATOR", indicator: "MACD_SIGNAL", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "macd_cross_below_signal",
          left: { kind: "INDICATOR", indicator: "MACD_LINE", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
          operator: "CROSS_BELOW",
          right: { kind: "INDICATOR", indicator: "MACD_SIGNAL", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
        }],
      },
    },
  },
  {
    id: "donchian_breakout",
    name: "Donchian Channel Breakout",
    category: "breakout",
    description: "Enter when price breaks above the 20-period highest high. Exit when price breaks below the lowest low.",
    hypothesis: "A new N-period high indicates that buyers are in control and price may continue in the breakout direction.",
    limitations: "Strong trend is required. In ranging markets, breakouts frequently fail (false breaks).",
    timeframes: ["1d", "1w"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "donchian_high_break",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_ABOVE",
          right: { kind: "INDICATOR", indicator: "DONCHIAN_HIGH", params: { period: 20 }, lag: 1 },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "donchian_low_break",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_BELOW",
          right: { kind: "INDICATOR", indicator: "DONCHIAN_LOW", params: { period: 20 }, lag: 1 },
        }],
      },
    },
  },
  {
    id: "bollinger_reversion",
    name: "Bollinger Band Mean Reversion",
    category: "mean_reversion",
    description: "Enter when price touches the lower Bollinger Band. Exit when price reaches the middle band.",
    hypothesis: "Price touching the lower band indicates a statistically extended deviation from the mean, creating a reversion opportunity.",
    limitations: "In strong downtrends, price can ride the lower band for extended periods. Requires confirming signals for high-confidence setups.",
    timeframes: ["1d"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "price_below_lower_band",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "LESS_THAN",
          right: { kind: "INDICATOR", indicator: "BOLLINGER_LOWER", params: { period: 20, stdDev: 2 } },
        }],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "price_above_middle_band",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "GREATER_THAN",
          right: { kind: "INDICATOR", indicator: "BOLLINGER_MIDDLE", params: { period: 20, stdDev: 2 } },
        }],
      },
    },
  },
  {
    id: "rsi_macd_combined",
    name: "RSI + MACD Combined",
    category: "momentum",
    description: "Enter only when both RSI is above 50 AND MACD has recently crossed bullish. A combined momentum filter.",
    hypothesis: "Requiring two independent indicators to align before entry reduces false signals at the cost of fewer total trades.",
    limitations: "More confirmation means fewer trades and potentially longer drawdown periods waiting for setups. Does not guarantee profitability.",
    timeframes: ["1d"],
    definition: {
      direction: "LONG_ONLY",
      timeframe: "1d",
      entry: {
        kind: "GROUP",
        id: "entry_root",
        combinator: "AND",
        children: [
          {
            kind: "CONDITION",
            id: "rsi_above_50",
            left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 } },
            operator: "GREATER_THAN",
            right: { kind: "CONSTANT", value: 50 },
          },
          {
            kind: "CONDITION",
            id: "macd_above_signal",
            left: { kind: "INDICATOR", indicator: "MACD_LINE", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
            operator: "GREATER_THAN",
            right: { kind: "INDICATOR", indicator: "MACD_SIGNAL", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
          },
        ],
      },
      exit: {
        kind: "GROUP",
        id: "exit_root",
        combinator: "AND",
        children: [{
          kind: "CONDITION",
          id: "rsi_below_50",
          left: { kind: "INDICATOR", indicator: "RSI", params: { period: 14 } },
          operator: "LESS_THAN",
          right: { kind: "CONSTANT", value: 50 },
        }],
      },
    },
  },
];

export const TEMPLATE_CATEGORY_LABELS: Record<StrategyTemplate["category"], string> = {
  trend_following: "Trend following",
  mean_reversion: "Mean reversion",
  momentum: "Momentum",
  breakout: "Breakout",
  volatility: "Volatility",
};

/** Starting point for a strategy created from a template; the user edits it in the Strategy Lab. */
const TEMPLATE_DEFAULTS = {
  universe: { type: "SINGLE_SYMBOL", symbolOrId: "RELIANCE" },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
  execution: {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: "VOLUME_AWARE",
    exchange: "NSE",
    product: "DELIVERY",
    slippageBps: 5,
    initialCapital: 100_000,
  },
} satisfies Pick<StrategyDefinition, "universe" | "risk" | "execution">;

/** The strategyDefinitions.create payload for a template: a complete definition the server accepts. */
export function templateCreateInput(template: StrategyTemplate): { name: string; description: string; definition: StrategyDefinition } {
  return {
    name: template.name,
    description: template.description,
    definition: { name: template.name, description: template.description, ...TEMPLATE_DEFAULTS, ...template.definition },
  };
}
