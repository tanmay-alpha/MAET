import type {
  StrategyCondition,
  StrategyExecutionConfig,
  StrategyOperand,
  StrategyRiskConfig,
  StrategyRuleGroup,
} from "@shared/strategy/ast";
import { rupees } from "./format";

/** Plain-text rendering of a strategy definition for the library, editor and summary views. */

export function operandText(op: StrategyOperand | undefined): string {
  if (!op) return "?";
  const lag = "lag" in op && op.lag ? `[${op.lag}]` : "";
  switch (op.kind) {
    case "CONSTANT":
      return String(op.value);
    case "PRICE":
    case "MARKET":
      return `${op.field}${lag}`;
    case "INDICATOR": {
      const params = Object.values(op.params ?? {}).join(", ");
      return `${op.indicator}(${params})${lag}`;
    }
    default:
      return "?";
  }
}

const OPERATOR_TEXT: Record<string, string> = {
  GREATER_THAN: ">",
  GREATER_THAN_OR_EQUAL: "≥",
  LESS_THAN: "<",
  LESS_THAN_OR_EQUAL: "≤",
  EQUAL_WITH_TOLERANCE: "≈",
  CROSS_ABOVE: "crosses above",
  CROSS_BELOW: "crosses below",
};

export function conditionText(condition: StrategyCondition): string {
  const left = operandText(condition.left);
  const right = operandText(condition.right);
  switch (condition.operator) {
    case "RISING":
      return `${left} rising`;
    case "FALLING":
      return `${left} falling`;
    case "BETWEEN":
    case "OUTSIDE":
      return `${left} ${condition.operator.toLowerCase()} ${right} and ${operandText(condition.rightHigh)}`;
    case "PERCENT_ABOVE":
    case "PERCENT_BELOW":
      return `${left} ${condition.percentValue ?? "?"}% ${condition.operator === "PERCENT_ABOVE" ? "above" : "below"} ${right}`;
    default:
      return `${left} ${OPERATOR_TEXT[condition.operator] ?? condition.operator.toLowerCase()} ${right}`;
  }
}

/** One line per rule group: "SMA(20) crosses above SMA(50) AND RSI(14) < 70". */
export function groupText(group: StrategyRuleGroup | undefined): string {
  if (!group?.children?.length) return "No rules";
  const joined = group.children
    .map((child) => (child.kind === "CONDITION" ? conditionText(child) : `(${groupText(child)})`))
    .join(` ${group.combinator} `);
  return group.negate ? `NOT (${joined})` : joined;
}

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

function sizing(risk: StrategyRiskConfig): string {
  switch (risk.sizingMethod) {
    case "PERCENT_OF_EQUITY":
      return `${risk.sizeValue}% of equity`;
    case "FIXED_QUANTITY":
      return `${risk.sizeValue.toLocaleString("en-IN")} shares`;
    case "FIXED_CAPITAL":
      return `${rupees(risk.sizeValue, 0)} per position`;
    default:
      return `${label(risk.sizingMethod)} ${risk.sizeValue}`;
  }
}

/** Risk settings that are set, as label/value pairs with units. */
export function riskRows(risk: StrategyRiskConfig | undefined): Array<[string, string]> {
  if (!risk) return [];
  const rows: Array<[string, string]> = [["Position size", sizing(risk)], ["Max open positions", String(risk.maximumOpenPositions)]];
  const pct: Array<[keyof StrategyRiskConfig, string]> = [
    ["stopLossPercent", "Stop loss"],
    ["takeProfitPercent", "Take profit"],
    ["trailingStopPercent", "Trailing stop"],
    ["maximumPositionPercent", "Max position"],
    ["maximumDailyLossPercent", "Max daily loss"],
    ["maximumDrawdownPercent", "Max drawdown"],
  ];
  for (const [key, name] of pct) {
    const value = risk[key];
    if (typeof value === "number") rows.push([name, `${value}%`]);
  }
  if (typeof risk.atrStopMultiplier === "number") rows.push(["ATR stop", `${risk.atrStopMultiplier}× ATR`]);
  if (typeof risk.cooldownBars === "number") rows.push(["Cooldown", `${risk.cooldownBars} bars`]);
  rows.push(["Pyramiding", risk.allowPyramiding ? `Up to ${risk.maximumPyramids ?? 1} adds` : "Off"]);
  return rows;
}

function fees(execution: StrategyExecutionConfig): string {
  if (execution.feeModel === "NONE") return "None";
  if (execution.feeModel === "FIXED_BPS") return `${execution.feeBps ?? 0} bps per leg`;
  const schedule = `${execution.exchange ?? "NSE"} ${(execution.product ?? "DELIVERY").toLowerCase()} statutory charges`;
  return execution.brokerage ? `${schedule} + ${rupees(execution.brokerage)} per order` : schedule;
}

/** Execution settings as label/value pairs with units. */
export function executionRows(execution: StrategyExecutionConfig | undefined): Array<[string, string]> {
  if (!execution) return [];
  const rows: Array<[string, string]> = [
    ["Initial capital", rupees(execution.initialCapital, 0)],
    ["Fills", execution.fillPolicy === "ON_CLOSE" ? "Signal bar close" : "Next bar open"],
    ["Intrabar order", label(execution.intrabarPolicy)],
    ["Fees", fees(execution)],
    ["Slippage", `${execution.slippageBps ?? 0} bps`],
  ];
  if (execution.benchmarkSymbol) rows.push(["Benchmark", execution.benchmarkSymbol]);
  return rows;
}
