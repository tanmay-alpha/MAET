/**
 * Zod schemas for the Strategy Lab domain.
 * Mirrors the TypeScript types in ast.ts with runtime validation.
 */

import { z } from "zod";
import {
  MAX_CONDITIONS, MAX_NESTING_DEPTH, MAX_LAG,
  MAX_OPEN_POSITIONS, MAX_PYRAMIDS, MAX_CUSTOM_SYMBOLS,
} from "./ast";

// ============================================================
// Operand schemas
// ============================================================

export const PriceFieldSchema = z.enum(["OPEN", "HIGH", "LOW", "CLOSE", "HL2", "HLC3", "OHLC4"]);
export const MarketFieldSchema = z.enum(["VOLUME", "RELATIVE_VOLUME", "GAP_PERCENT", "DAY_CHANGE_PERCENT"]);
export const IndicatorTypeSchema = z.enum([
  "SMA", "EMA", "RSI",
  "MACD_LINE", "MACD_SIGNAL", "MACD_HISTOGRAM",
  "BOLLINGER_UPPER", "BOLLINGER_MIDDLE", "BOLLINGER_LOWER",
  "ATR", "VWAP", "OBV", "SUPERTREND",
  "DONCHIAN_HIGH", "DONCHIAN_LOW",
]);

const LagSchema = z.number().int().min(0).max(MAX_LAG).optional();

export const PriceOperandSchema = z.object({
  kind: z.literal("PRICE"),
  field: PriceFieldSchema,
  lag: LagSchema,
});

export const MarketOperandSchema = z.object({
  kind: z.literal("MARKET"),
  field: MarketFieldSchema,
  lag: LagSchema,
});

export const IndicatorOperandSchema = z.object({
  kind: z.literal("INDICATOR"),
  indicator: IndicatorTypeSchema,
  params: z.record(z.string(), z.number()),
  lag: LagSchema,
});

export const ConstantOperandSchema = z.object({
  kind: z.literal("CONSTANT"),
  value: z.number().finite(),
});

export const StrategyOperandSchema = z.discriminatedUnion("kind", [
  PriceOperandSchema,
  MarketOperandSchema,
  IndicatorOperandSchema,
  ConstantOperandSchema,
]);

// ============================================================
// Operator schema
// ============================================================

export const StrategyOperatorSchema = z.enum([
  "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL",
  "EQUAL_WITH_TOLERANCE", "CROSS_ABOVE", "CROSS_BELOW",
  "RISING", "FALLING", "BETWEEN", "OUTSIDE",
  "PERCENT_ABOVE", "PERCENT_BELOW",
]);

// ============================================================
// Condition schema
// ============================================================

export const StrategyConditionSchema = z.object({
  kind: z.literal("CONDITION"),
  id: z.string().min(1),
  left: StrategyOperandSchema,
  operator: StrategyOperatorSchema,
  right: StrategyOperandSchema,
  rightHigh: StrategyOperandSchema.optional(),
  percentValue: z.number().optional(),
});

// ============================================================
// Rule group schema (recursive — Zod lazy)
// ============================================================

export const LogicalCombinatorSchema = z.enum(["AND", "OR"]);

export type StrategyRuleGroupInput = {
  kind: "GROUP";
  id: string;
  combinator: "AND" | "OR";
  negate?: boolean;
  children: Array<StrategyRuleGroupInput | z.infer<typeof StrategyConditionSchema>>;
};

export const StrategyRuleGroupSchema: z.ZodType<StrategyRuleGroupInput> = z.lazy(() =>
  z.object({
    kind: z.literal("GROUP"),
    id: z.string().min(1),
    combinator: LogicalCombinatorSchema,
    negate: z.boolean().optional(),
    children: z.array(z.union([StrategyRuleGroupSchema, StrategyConditionSchema])).min(0).max(MAX_CONDITIONS),
  })
);

// ============================================================
// Universe schema
// ============================================================

export const UniverseTypeSchema = z.enum([
  "SINGLE_SYMBOL", "WATCHLIST", "SAVED_SCREENER",
  "VERIFIED_INDEX", "VERIFIED_SECTOR", "CUSTOM_SYMBOL_LIST",
]);

export const StrategyUniverseSchema = z.object({
  type: UniverseTypeSchema,
  symbolOrId: z.string().min(1).max(100),
  customSymbols: z.array(z.string().min(1).max(20)).max(MAX_CUSTOM_SYMBOLS).optional(),
  survivorshipBiasRisk: z.boolean().optional(),
});

// ============================================================
// Risk configuration schema
// ============================================================

export const PositionSizingMethodSchema = z.enum([
  "FIXED_QUANTITY", "FIXED_CAPITAL", "PERCENT_OF_EQUITY",
  "RISK_PER_TRADE", "VOLATILITY_TARGET",
]);

export const StrategyRiskConfigSchema = z.object({
  sizingMethod: PositionSizingMethodSchema,
  sizeValue: z.number().positive().finite(),
  stopLossPercent: z.number().positive().finite().optional(),
  takeProfitPercent: z.number().positive().finite().optional(),
  trailingStopPercent: z.number().positive().finite().optional(),
  atrStopMultiplier: z.number().positive().finite().optional(),
  maximumOpenPositions: z.number().int().min(1).max(MAX_OPEN_POSITIONS),
  maximumPositionPercent: z.number().min(1).max(100).optional(),
  maximumSectorExposurePercent: z.number().min(1).max(100).optional(),
  maximumDailyLossPercent: z.number().min(0.1).max(50).optional(),
  maximumDrawdownPercent: z.number().min(1).max(100).optional(),
  cooldownBars: z.number().int().min(0).max(500).optional(),
  allowPyramiding: z.boolean(),
  maximumPyramids: z.number().int().min(1).max(MAX_PYRAMIDS).optional(),
});

// ============================================================
// Execution configuration schema
// ============================================================

export const FillPolicySchema = z.enum(["NEXT_BAR_OPEN", "ON_CLOSE"]);
export const IntrabarPolicySchema = z.enum(["CONSERVATIVE", "STOP_FIRST", "TARGET_FIRST"]);
export const FeeModelTypeSchema = z.enum(["NONE", "FIXED_BPS", "VOLUME_AWARE"]);

export const StrategyExecutionConfigSchema = z.object({
  fillPolicy: FillPolicySchema.default("NEXT_BAR_OPEN"),
  intrabarPolicy: IntrabarPolicySchema.default("CONSERVATIVE"),
  feeModel: FeeModelTypeSchema,
  feeBps: z.number().min(0).max(500).optional(),
  brokerage: z.number().min(0).optional(),
  stt: z.number().min(0).optional(),
  exchangeCharges: z.number().min(0).optional(),
  gst: z.number().min(0).optional(),
  sebiCharges: z.number().min(0).optional(),
  stampDuty: z.number().min(0).optional(),
  slippageBps: z.number().min(0).max(500).optional(),
  initialCapital: z.number().positive().finite().max(1_000_000_000),
  benchmarkSymbol: z.string().optional(),
});

// ============================================================
// Strategy direction
// ============================================================

export const StrategyDirectionSchema = z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]);

// ============================================================
// Full strategy definition schema
// ============================================================

export const StrategyDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  direction: StrategyDirectionSchema,
  universe: StrategyUniverseSchema,
  timeframe: z.string().min(1).max(10),
  entry: StrategyRuleGroupSchema,
  exit: StrategyRuleGroupSchema,
  risk: StrategyRiskConfigSchema,
  execution: StrategyExecutionConfigSchema,
});

// ============================================================
// Deployment schemas
// ============================================================

export const DeploymentModeSchema = z.enum(["OFF", "ALERT_ONLY", "MANUAL_CONFIRM", "AUTO_PAPER"]);
export const DeploymentStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "STOPPED", "ERROR"]);

export const DeploymentRiskLimitsSchema = z.object({
  maximumOpenPositions: z.number().int().min(1).max(MAX_OPEN_POSITIONS).optional(),
  maximumPositionCapital: z.number().positive().optional(),
  maximumDailyLossPercent: z.number().min(0.1).max(50).optional(),
  maximumDrawdownPercent: z.number().min(1).max(100).optional(),
  userKillSwitch: z.boolean().optional(),
  deploymentKillSwitch: z.boolean().optional(),
});

// ============================================================
// Job / backtest run schemas
// ============================================================

export const BacktestJobStatusSchema = z.enum([
  "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
]);

export const SweepParameterSchema = z.object({
  name: z.string().min(1).max(50),
  path: z.string().min(1),  // dot-path into strategy definition
  values: z.array(z.number().finite()).min(1).max(10),
});

export const WalkForwardModeSchema = z.enum(["ANCHORED", "ROLLING"]);

export const SignalEventTypeSchema = z.enum([
  "ENTRY_LONG", "ENTRY_SHORT", "EXIT_LONG", "EXIT_SHORT", "STOP_HIT", "TARGET_HIT",
]);

export const ExecutionDecisionSchema = z.enum([
  "ORDER_CREATED", "PROPOSAL_CREATED", "ALERT_ONLY",
  "REJECTED_RISK", "REJECTED_DATA", "REJECTED_ACCOUNT",
  "REJECTED_DUPLICATE", "REJECTED_MARKET_STATE",
  "DEPLOYMENT_PAUSED",
]);
