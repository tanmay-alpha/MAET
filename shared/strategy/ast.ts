/**
 * Strategy AST — versioned, serializable, no-eval rule tree.
 *
 * Max nesting depth: 8 levels
 * Max conditions per strategy: 100
 * No future indexes. No negative lags. No executable code.
 */

// ============================================================
// Operand types
// ============================================================

export type PriceOperandType =
  | "OPEN" | "HIGH" | "LOW" | "CLOSE" | "HL2" | "HLC3" | "OHLC4";

export type MarketOperandType =
  | "VOLUME" | "RELATIVE_VOLUME" | "GAP_PERCENT" | "DAY_CHANGE_PERCENT";

export type IndicatorType =
  | "SMA" | "EMA" | "RSI"
  | "MACD_LINE" | "MACD_SIGNAL" | "MACD_HISTOGRAM"
  | "BOLLINGER_UPPER" | "BOLLINGER_MIDDLE" | "BOLLINGER_LOWER"
  | "ATR" | "VWAP" | "OBV" | "SUPERTREND"
  | "DONCHIAN_HIGH" | "DONCHIAN_LOW";

export interface PriceOperand {
  kind: "PRICE";
  field: PriceOperandType;
  lag?: number; // 0 = current bar; must be >= 0 and <= MAX_LAG
}

export interface MarketOperand {
  kind: "MARKET";
  field: MarketOperandType;
  lag?: number;
}

export interface IndicatorOperand {
  kind: "INDICATOR";
  indicator: IndicatorType;
  params: Record<string, number>; // e.g. { period: 20, stdDev: 2 }
  lag?: number;
}

export interface ConstantOperand {
  kind: "CONSTANT";
  value: number;
}

export type StrategyOperand =
  | PriceOperand
  | MarketOperand
  | IndicatorOperand
  | ConstantOperand;

// ============================================================
// Operators
// ============================================================

export type ComparisonOperator =
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "EQUAL_WITH_TOLERANCE";

export type CrossOperator =
  | "CROSS_ABOVE"  // prev left <= prev right AND curr left > curr right
  | "CROSS_BELOW"; // prev left >= prev right AND curr left < curr right

export type TrendOperator =
  | "RISING"   // current > previous
  | "FALLING"; // current < previous

export type RangeOperator =
  | "BETWEEN"  // left > low AND left < high (uses two right operands)
  | "OUTSIDE"; // left < low OR left > high

export type PercentOperator =
  | "PERCENT_ABOVE" // left > right * (1 + pct/100)
  | "PERCENT_BELOW"; // left < right * (1 - pct/100)

export type StrategyOperator =
  | ComparisonOperator
  | CrossOperator
  | TrendOperator
  | RangeOperator
  | PercentOperator;

// ============================================================
// Condition leaf node
// ============================================================

export interface StrategyCondition {
  kind: "CONDITION";
  id: string;
  left: StrategyOperand;
  operator: StrategyOperator;
  right: StrategyOperand;
  rightHigh?: StrategyOperand; // used for BETWEEN / OUTSIDE
  percentValue?: number;       // used for PERCENT_ABOVE / PERCENT_BELOW
}

// ============================================================
// Rule group (logical combinator)
// ============================================================

export type LogicalCombinator = "AND" | "OR";

export interface StrategyRuleGroup {
  kind: "GROUP";
  id: string;
  combinator: LogicalCombinator;
  negate?: boolean;
  children: Array<StrategyRuleGroup | StrategyCondition>;
}

// ============================================================
// Actions
// ============================================================

export type EntryAction = "ENTER_LONG" | "ENTER_SHORT";
export type ExitAction = "EXIT_POSITION" | "EXIT_LONG" | "EXIT_SHORT";
export type StrategyAction = EntryAction | ExitAction;

// ============================================================
// Strategy direction
// ============================================================

export type StrategyDirection = "LONG_ONLY" | "SHORT_ONLY" | "LONG_SHORT";

// ============================================================
// Universe
// ============================================================

export type UniverseType =
  | "SINGLE_SYMBOL"
  | "WATCHLIST"
  | "SAVED_SCREENER"
  | "VERIFIED_INDEX"
  | "VERIFIED_SECTOR"
  | "CUSTOM_SYMBOL_LIST";

export interface StrategyUniverse {
  type: UniverseType;
  symbolOrId: string;           // symbol, watchlist ID, screener ID, index name, sector
  customSymbols?: string[];     // for CUSTOM_SYMBOL_LIST, max 50
  survivorshipBiasRisk?: boolean;
}

// ============================================================
// Risk configuration
// ============================================================

export type PositionSizingMethod =
  | "FIXED_QUANTITY"
  | "FIXED_CAPITAL"
  | "PERCENT_OF_EQUITY"
  | "RISK_PER_TRADE"
  | "VOLATILITY_TARGET";

export interface StrategyRiskConfig {
  sizingMethod: PositionSizingMethod;
  sizeValue: number;              // shares / capital / percent / risk amount

  stopLossPercent?: number;       // > 0
  takeProfitPercent?: number;     // > 0
  trailingStopPercent?: number;   // > 0
  atrStopMultiplier?: number;     // > 0

  maximumOpenPositions: number;   // 1–50
  maximumPositionPercent?: number;         // 1–100
  maximumSectorExposurePercent?: number;   // 1–100
  maximumDailyLossPercent?: number;        // 0.1–50
  maximumDrawdownPercent?: number;         // 1–100

  cooldownBars?: number;          // 0–500
  allowPyramiding: boolean;       // default false
  maximumPyramids?: number;       // 1–5 if allowPyramiding = true
}

// ============================================================
// Execution configuration
// ============================================================

export type FillPolicy = "NEXT_BAR_OPEN" | "ON_CLOSE";
export type IntrabarPolicy = "CONSERVATIVE" | "STOP_FIRST" | "TARGET_FIRST";
export type FeeModelType = "NONE" | "FIXED_BPS" | "VOLUME_AWARE";

export interface StrategyExecutionConfig {
  fillPolicy: FillPolicy;         // default NEXT_BAR_OPEN
  intrabarPolicy: IntrabarPolicy; // default CONSERVATIVE
  feeModel: FeeModelType;
  feeBps?: number;
  brokerage?: number;             // INR per crore
  stt?: number;                   // bps
  exchangeCharges?: number;       // bps
  gst?: number;                   // bps
  sebiCharges?: number;           // bps
  stampDuty?: number;             // bps
  slippageBps?: number;
  initialCapital: number;         // > 0
  benchmarkSymbol?: string;
}

// ============================================================
// Full strategy definition (persisted draft)
// ============================================================

export interface StrategyDefinition {
  name: string;
  description?: string;
  direction?: StrategyDirection;
  universe?: StrategyUniverse;
  timeframe?: string;
  entry: StrategyRuleGroup;
  exit: StrategyRuleGroup;
  entryRules?: StrategyRuleGroup;
  exitRules?: StrategyRuleGroup;
  risk?: StrategyRiskConfig;
  execution?: StrategyExecutionConfig;
  portfolio?: any;
}

// ============================================================
// Immutable version (frozen at creation time)
// ============================================================

export interface StrategyVersion {
  versionNumber: number;
  definition: StrategyDefinition;
  definitionHash: string;   // SHA-256 of canonical JSON (no timestamps, no user ID)
  engineVersion: string;
  indicatorVersion: string;
  schemaVersion: number;
  createdAt: string;        // ISO-8601
}

// ============================================================
// Validation
// ============================================================

export const MAX_NESTING_DEPTH = 8;
export const MAX_CONDITIONS = 100;
export const MAX_LAG = 50;
export const MAX_CUSTOM_SYMBOLS = 50;
export const MAX_OPEN_POSITIONS = 50;
export const MAX_PYRAMIDS = 5;

export interface StrategyValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings: Array<{ path: string; message: string }>;
  conditionCount: number;
  maxDepthReached: number;
}

// ============================================================
// AST utilities
// ============================================================

export function countConditions(node: StrategyRuleGroup | StrategyCondition): number {
  if (node.kind === "CONDITION") return 1;
  return node.children.reduce((acc, child) => acc + countConditions(child), 0);
}

export function maxDepth(node: StrategyRuleGroup | StrategyCondition, current = 0): number {
  if (node.kind === "CONDITION") return current;
  return Math.max(...node.children.map((c) => maxDepth(c, current + 1)));
}

export function validateAst(definition: StrategyDefinition): StrategyValidationResult {
  const errors: Array<{ path: string; message: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];

  const entryCount = countConditions(definition.entry);
  const exitCount = countConditions(definition.exit);
  const totalCount = entryCount + exitCount;
  const entryDepth = maxDepth(definition.entry);
  const exitDepth = maxDepth(definition.exit);

  if (totalCount > MAX_CONDITIONS) {
    errors.push({ path: "entry+exit", message: `Too many conditions: ${totalCount} (max ${MAX_CONDITIONS})` });
  }
  if (entryDepth > MAX_NESTING_DEPTH) {
    errors.push({ path: "entry", message: `Entry rule nesting too deep: ${entryDepth} (max ${MAX_NESTING_DEPTH})` });
  }
  if (exitDepth > MAX_NESTING_DEPTH) {
    errors.push({ path: "exit", message: `Exit rule nesting too deep: ${exitDepth} (max ${MAX_NESTING_DEPTH})` });
  }
  if (entryCount === 0) {
    errors.push({ path: "entry", message: "At least one entry condition is required" });
  }
  if (exitCount === 0) {
    warnings.push({ path: "exit", message: "No explicit exit rules — position will only close at end of period" });
  }
  if (definition.execution && (definition.execution.initialCapital <= 0 || !isFinite(definition.execution.initialCapital))) {
    errors.push({ path: "execution.initialCapital", message: "Initial capital must be a positive finite number" });
  }
  if (definition.risk && (definition.risk.maximumOpenPositions < 1 || definition.risk.maximumOpenPositions > MAX_OPEN_POSITIONS)) {
    errors.push({ path: "risk.maximumOpenPositions", message: `Must be between 1 and ${MAX_OPEN_POSITIONS}` });
  }
  if (definition.risk?.allowPyramiding && (definition.risk.maximumPyramids ?? 0) > MAX_PYRAMIDS) {
    errors.push({ path: "risk.maximumPyramids", message: `Max pyramids is ${MAX_PYRAMIDS}` });
  }

  validateLags(definition.entry, "entry", errors);
  validateLags(definition.exit, "exit", errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    conditionCount: totalCount,
    maxDepthReached: Math.max(entryDepth, exitDepth),
  };
}

function validateLags(
  node: StrategyRuleGroup | StrategyCondition,
  path: string,
  errors: Array<{ path: string; message: string }>,
): void {
  if (node.kind === "CONDITION") {
    checkOperandLag(node.left, path, errors);
    checkOperandLag(node.right, path, errors);
    if (node.rightHigh) checkOperandLag(node.rightHigh, path, errors);
    return;
  }
  node.children.forEach((child, i) => validateLags(child, `${path}[${i}]`, errors));
}

function checkOperandLag(operand: StrategyOperand, path: string, errors: Array<{ path: string; message: string }>): void {
  if (operand.kind === "CONSTANT") return;
  const lag = operand.lag ?? 0;
  if (lag < 0) errors.push({ path, message: `Negative lag (${lag}) is not allowed — no future references` });
  if (lag > MAX_LAG) errors.push({ path, message: `Lag ${lag} exceeds maximum allowed (${MAX_LAG})` });
}

// ============================================================
// Canonical JSON serializer (for deterministic hash)
// Excludes: createdAt, updatedAt, userId, id fields
// ============================================================

export function canonicalDefinitionJson(definition: StrategyDefinition): string {
  return JSON.stringify(definition, Object.keys(definition).sort());
}
