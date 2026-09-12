/**
 * Preset-to-V3 Adapter
 *
 * Translates legacy Backtest Lab V2 StrategyParams + RiskConfig into a canonical
 * StrategyDefinition (AST) that the V3 runner (runner-v3.ts) understands.
 *
 * This is a one-way bridge. The V2 StrategyParams are now the "user-facing preset"
 * format; the V3 AST is the execution format. All new strategies must be expressed
 * as ASTs, but we keep this adapter so existing presets continue to work after we
 * route the Backtest Lab to the V3 engine.
 *
 * @deprecated Do not add new strategy types here. Add them as V3 ASTs directly.
 */

import type { StrategyDefinition, StrategyRuleGroup, StrategyCondition } from "@shared/strategy/ast";
import type { StrategyParams, RiskConfig } from "./strategies-v2";

// ============================================================
// Helpers to build common AST fragments
// ============================================================

function condition(
  id: string,
  leftKind: "INDICATOR" | "PRICE",
  leftIndicator: string | undefined,
  leftParams: Record<string, number>,
  leftField: string,
  operator: string,
  rightKind: "INDICATOR" | "PRICE" | "CONSTANT",
  rightIndicator: string | undefined,
  rightParams: Record<string, number>,
  rightField: string | number,
  leftLag?: number,
  rightLag?: number,
): StrategyCondition {
  const left: any =
    leftKind === "INDICATOR"
      ? { kind: "INDICATOR", indicator: leftIndicator!, params: leftParams, lag: leftLag ?? 0 }
      : { kind: "PRICE", field: leftField, lag: leftLag ?? 0 };

  const right: any =
    rightKind === "INDICATOR"
      ? { kind: "INDICATOR", indicator: rightIndicator!, params: rightParams, lag: rightLag ?? 0 }
      : rightKind === "CONSTANT"
      ? { kind: "CONSTANT", value: rightField as number }
      : { kind: "PRICE", field: rightField as string, lag: rightLag ?? 0 };

  return {
    kind: "CONDITION",
    id,
    left,
    operator: operator as any,
    right,
  };
}

function group(
  id: string,
  combinator: "AND" | "OR",
  children: Array<StrategyRuleGroup | StrategyCondition>,
): StrategyRuleGroup {
  return { kind: "GROUP", id, combinator, children };
}

// ============================================================
// Strategy adapters per type
// ============================================================

function buildSmaCrossDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const fast = params.fastPeriod ?? 10;
  const slow = params.slowPeriod ?? 20;
  return {
    name: `SMA Cross (${fast}/${slow})`,
    direction: "LONG_ONLY",
    entry: group("entry", "AND", [
      condition("e1", "INDICATOR", "SMA", { period: fast }, "SMA", "CROSS_ABOVE", "INDICATOR", "SMA", { period: slow }, "SMA"),
    ]),
    exit: group("exit", "AND", [
      condition("x1", "INDICATOR", "SMA", { period: fast }, "SMA", "CROSS_BELOW", "INDICATOR", "SMA", { period: slow }, "SMA"),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

function buildEmaCrossDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const fast = params.fastPeriod ?? 9;
  const slow = params.slowPeriod ?? 21;
  return {
    name: `EMA Cross (${fast}/${slow})`,
    direction: "LONG_ONLY",
    entry: group("entry", "AND", [
      condition("e1", "INDICATOR", "EMA", { period: fast }, "EMA", "CROSS_ABOVE", "INDICATOR", "EMA", { period: slow }, "EMA"),
    ]),
    exit: group("exit", "AND", [
      condition("x1", "INDICATOR", "EMA", { period: fast }, "EMA", "CROSS_BELOW", "INDICATOR", "EMA", { period: slow }, "EMA"),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

function buildRsiReversalDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const period = params.rsiPeriod ?? 14;
  const oversold = params.rsiOversold ?? 30;
  const overbought = params.rsiOverbought ?? 70;
  return {
    name: `RSI Reversal (${period}, OB:${overbought} OS:${oversold})`,
    direction: "LONG_ONLY",
    // Entry: RSI crosses above oversold level
    entry: group("entry", "AND", [
      condition("e1", "INDICATOR", "RSI", { period }, "RSI", "CROSS_ABOVE", "CONSTANT", undefined, {}, oversold),
    ]),
    // Exit: RSI crosses below overbought level
    exit: group("exit", "AND", [
      condition("x1", "INDICATOR", "RSI", { period }, "RSI", "CROSS_BELOW", "CONSTANT", undefined, {}, overbought),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

function buildMacdCrossDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const fast = params.fastPeriod ?? 12;
  const slow = params.slowPeriod ?? 26;
  const signal = params.signalPeriod ?? 9;
  return {
    name: `MACD Cross (${fast}/${slow}/${signal})`,
    direction: "LONG_ONLY",
    // Entry: MACD line crosses above signal line
    entry: group("entry", "AND", [
      condition("e1", "INDICATOR", "MACD_LINE", { fast, slow, signal }, "MACD_LINE",
        "CROSS_ABOVE", "INDICATOR", "MACD_SIGNAL", { fast, slow, signal }, "MACD_SIGNAL"),
    ]),
    // Exit: MACD line crosses below signal line
    exit: group("exit", "AND", [
      condition("x1", "INDICATOR", "MACD_LINE", { fast, slow, signal }, "MACD_LINE",
        "CROSS_BELOW", "INDICATOR", "MACD_SIGNAL", { fast, slow, signal }, "MACD_SIGNAL"),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

function buildDonchianBreakoutDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const period = params.donchianPeriod ?? 20;
  return {
    name: `Donchian Breakout (${period})`,
    direction: "LONG_ONLY",
    // Entry: close breaks above Donchian high (price exceeds upper channel)
    entry: group("entry", "AND", [
      condition("e1", "PRICE", undefined, {}, "CLOSE", "CROSS_ABOVE", "INDICATOR", "DONCHIAN_HIGH", { period }, "DONCHIAN_HIGH"),
    ]),
    // Exit: close breaks below Donchian low
    exit: group("exit", "AND", [
      condition("x1", "PRICE", undefined, {}, "CLOSE", "CROSS_BELOW", "INDICATOR", "DONCHIAN_LOW", { period }, "DONCHIAN_LOW"),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

function buildBollingerMeanReversionDefinition(params: StrategyParams, risk: RiskConfig): StrategyDefinition {
  const period = params.bollingerPeriod ?? 20;
  const stdDev = params.bollingerStdDev ?? 2;
  return {
    name: `Bollinger Mean Reversion (${period}, ${stdDev}σ)`,
    direction: "LONG_ONLY",
    // Entry: price crosses above Bollinger lower band (oversold reversal)
    entry: group("entry", "AND", [
      condition("e1", "PRICE", undefined, {}, "CLOSE", "CROSS_ABOVE",
        "INDICATOR", "BOLLINGER_LOWER", { period, stdDev }, "BOLLINGER_LOWER"),
    ]),
    // Exit: price crosses above Bollinger upper band (mean-reversion target)
    exit: group("exit", "AND", [
      condition("x1", "PRICE", undefined, {}, "CLOSE", "CROSS_ABOVE",
        "INDICATOR", "BOLLINGER_UPPER", { period, stdDev }, "BOLLINGER_UPPER"),
    ]),
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: risk.positionSizePercent ?? 100,
      maximumOpenPositions: risk.maximumOpenPositions ?? 1,
      stopLossPercent: risk.stopLossPercent,
      takeProfitPercent: risk.takeProfitPercent,
      trailingStopPercent: risk.trailingStopPercent,
      allowPyramiding: false,
    },
    execution: buildExecution(risk),
  };
}

// ============================================================
// Shared execution config builder
// ============================================================

function buildExecution(risk: RiskConfig): StrategyDefinition["execution"] {
  return {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: risk.feeBps > 0 ? "FIXED_BPS" : "NONE",
    feeBps: risk.feeBps,
    slippageBps: risk.slippageBps,
    initialCapital: risk.initialCapital,
  };
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Translate a Backtest Lab V2 preset into a canonical V3 StrategyDefinition.
 *
 * @param params  - The strategy parameters from the Backtest Lab UI
 * @param risk    - The risk/execution configuration
 * @returns StrategyDefinition suitable for runBacktestV3()
 * @throws Error if the strategy type is unknown or unsupported
 */
export function presetToV3Definition(
  params: StrategyParams,
  risk: RiskConfig,
): StrategyDefinition {
  switch (params.type) {
    case "SMA_CROSS":
      return buildSmaCrossDefinition(params, risk);
    case "EMA_CROSS":
      return buildEmaCrossDefinition(params, risk);
    case "RSI_REVERSAL":
      return buildRsiReversalDefinition(params, risk);
    case "MACD_CROSS":
      return buildMacdCrossDefinition(params, risk);
    case "DONCHIAN_BREAKOUT":
      return buildDonchianBreakoutDefinition(params, risk);
    case "BOLLINGER_MEAN_REVERSION":
      return buildBollingerMeanReversionDefinition(params, risk);
    case "COMBINED_RULES":
      // COMBINED_RULES does not map cleanly to AST — it uses a freeform rule structure.
      // For now: return a passthrough definition that produces no signals (safe default).
      // TODO: Implement proper COMBINED_RULES → AST translation.
      throw new Error(
        "COMBINED_RULES strategy type cannot be automatically translated to V3 AST. " +
        "Please define your strategy using the Strategy Builder and run it natively as V3."
      );
    default: {
      const _exhaustive: never = params.type;
      throw new Error(`Unknown strategy type: ${_exhaustive}`);
    }
  }
}
