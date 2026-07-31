/**
 * Stock scorecard domain — deterministic, versioned, no LLM required.
 *
 * Each score is a percentile-normalised value from 0 to 100, or undefined when
 * the underlying data is insufficient. Missing inputs lower confidence but
 * never produce a zero score.
 */

export type ScorecardInputs = {
  peRatio?: number;
  pbRatio?: number;
  earningsYield?: number;
  freeCashFlowYield?: number;
  roe?: number;
  roce?: number;
  revenueGrowth?: number;
  epsGrowth?: number;
  priceChange3m?: number;
  priceChange1y?: number;
  relativeVolume?: number;
  rsi14?: number;
  macdHistogram?: number;
  macdTrend?: "bullish" | "bearish" | "neutral" | undefined;
  debtToEquity?: number;
  interestCoverage?: number;
  currentRatio?: number;
  netMargin?: number;
  grossMargin?: number;
  freeCashFlow?: number;
  operatingCashFlow?: number;
  marketCap?: number;
  sector?: string;
  /** Optional fixed timestamp for deterministic tests; defaults to now() in production. */
  asOf?: string;
};

export type ScorecardResult = {
  quality: number | undefined;
  valuation: number | undefined;
  growth: number | undefined;
  momentum: number | undefined;
  financialHealth: number | undefined;
  risk: number | undefined;
  overall: number | undefined;
  confidence: number;
  coverage: number;
  methodVersion: string;
  qualityScore: number | undefined;
  valuationScore: number | undefined;
  growthScore: number | undefined;
  momentumScore: number | undefined;
  financialHealthScore: number | undefined;
  riskScore: number | undefined;
  overallScore: number | undefined;
  confidenceScore: number;
  inputCoverage: number;
  strengths: string[];
  risks: string[];
  missingInputs: string[];
  asOf: string;
  provenance: string[];
};

const STRENGTH_THRESHOLD = 70;
const RISK_THRESHOLD = 35;
const CONFIDENCE_HIGH = 0.8;
const CONFIDENCE_MEDIUM = 0.5;
const CONFIDENCE_LOW = 0.2;

function clampScore(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function percentile(value: number | undefined, high: number, low: number): number | undefined {
  if (value === undefined) return undefined;
  if (high <= low) return 50;
  const pct = ((value - low) / (high - low)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function invertPercentile(value: number | undefined, high: number, low: number): number | undefined {
  const p = percentile(value, high, low);
  return p === undefined ? undefined : 100 - p;
}

function isStrong(v: number | undefined): boolean {
  return v !== undefined && v >= STRENGTH_THRESHOLD;
}

function isRisky(v: number | undefined): boolean {
  return v !== undefined && v <= RISK_THRESHOLD;
}

export function calculateStockScorecard(input: ScorecardInputs): ScorecardResult {
  const missing: string[] = [];
  const present: string[] = [];

  if (input.peRatio !== undefined) present.push("peRatio"); else missing.push("peRatio");
  if (input.pbRatio !== undefined) present.push("pbRatio"); else missing.push("pbRatio");
  if (input.earningsYield !== undefined) present.push("earningsYield"); else missing.push("earningsYield");
  if (input.freeCashFlowYield !== undefined) present.push("freeCashFlowYield"); else missing.push("freeCashFlowYield");
  if (input.roe !== undefined) present.push("roe"); else missing.push("roe");
  if (input.roce !== undefined) present.push("roce"); else missing.push("roce");
  if (input.revenueGrowth !== undefined) present.push("revenueGrowth"); else missing.push("revenueGrowth");
  if (input.epsGrowth !== undefined) present.push("epsGrowth"); else missing.push("epsGrowth");
  if (input.priceChange3m !== undefined) present.push("priceChange3m"); else missing.push("priceChange3m");
  if (input.priceChange1y !== undefined) present.push("priceChange1y"); else missing.push("priceChange1y");
  if (input.relativeVolume !== undefined) present.push("relativeVolume"); else missing.push("relativeVolume");
  if (input.rsi14 !== undefined) present.push("rsi14"); else missing.push("rsi14");
  if (input.macdHistogram !== undefined) present.push("macdHistogram"); else missing.push("macdHistogram");
  if (input.macdTrend !== undefined) present.push("macdTrend"); else missing.push("macdTrend");
  if (input.debtToEquity !== undefined) present.push("debtToEquity"); else missing.push("debtToEquity");
  if (input.interestCoverage !== undefined) present.push("interestCoverage"); else missing.push("interestCoverage");
  if (input.currentRatio !== undefined) present.push("currentRatio"); else missing.push("currentRatio");
  if (input.netMargin !== undefined) present.push("netMargin"); else missing.push("netMargin");
  if (input.grossMargin !== undefined) present.push("grossMargin"); else missing.push("grossMargin");
  if (input.freeCashFlow !== undefined) present.push("freeCashFlow"); else missing.push("freeCashFlow");
  if (input.operatingCashFlow !== undefined) present.push("operatingCashFlow"); else missing.push("operatingCashFlow");
  if (input.marketCap !== undefined) present.push("marketCap"); else missing.push("marketCap");
  if (input.sector !== undefined) present.push("sector"); else missing.push("sector");

  const inputCoverage = present.length / (present.length + missing.length);

  // Confidence is proportional to coverage but never drops to zero
  const confidenceScore = Math.max(CONFIDENCE_LOW, inputCoverage * 0.9 + 0.1);

  // --- Valuation Score (lower is better for PE/PB) ---
  const qualityWeighted = [
    percentile(input.earningsYield, 0.15, 0),
    percentile(input.freeCashFlowYield, 0.12, -0.05),
    input.roe !== undefined ? (input.roe >= 0.15 ? 85 : input.roe <= 0.05 ? 25 : 55) : undefined,
    input.roce !== undefined ? (input.roce >= 0.15 ? 85 : input.roce <= 0.05 ? 25 : 55) : undefined,
    input.netMargin !== undefined ? Math.max(0, Math.min(100, input.netMargin * 400)) : undefined,
  ].filter((v): v is number => v !== undefined);

  const qualityScore = qualityWeighted.length > 0
    ? qualityWeighted.reduce((s, v) => s + v, 0) / qualityWeighted.length
    : undefined;

  // --- Valuation Score ---
  const valuationComponents = [
    invertPercentile(input.peRatio, 80, 5),
    invertPercentile(input.pbRatio, 10, 0.5),
    invertPercentile(input.earningsYield, 0.15, 0),
    invertPercentile(input.freeCashFlowYield, 0.12, -0.05),
  ].filter((v): v is number => v !== undefined);

  const valuationScore = valuationComponents.length > 0
    ? valuationComponents.reduce((s, v) => s + v, 0) / valuationComponents.length
    : undefined;

  // --- Growth Score ---
  const growthComponents = [
    input.revenueGrowth !== undefined ? Math.max(0, Math.min(100, input.revenueGrowth * 5 + 50)) : undefined,
    input.epsGrowth !== undefined ? Math.max(0, Math.min(100, input.epsGrowth * 5 + 50)) : undefined,
  ].filter((v): v is number => v !== undefined);

  const growthScore = growthComponents.length > 0
    ? growthComponents.reduce((s, v) => s + v, 0) / growthComponents.length
    : undefined;

  // --- Momentum Score ---
  const momentumComponents = [
    input.priceChange3m !== undefined ? Math.max(0, Math.min(100, input.priceChange3m * 3 + 50)) : undefined,
    input.priceChange1y !== undefined ? Math.max(0, Math.min(100, input.priceChange1y * 1.5 + 50)) : undefined,
    input.rsi14 !== undefined ? Math.max(0, Math.min(100, input.rsi14)) : undefined,
    input.macdTrend === "bullish" ? 80 : input.macdTrend === "bearish" ? 25 : input.macdTrend === "neutral" ? 50 : undefined,
  ].filter((v): v is number => v !== undefined);

  const momentumScore = momentumComponents.length > 0
    ? momentumComponents.reduce((s, v) => s + v, 0) / momentumComponents.length
    : undefined;

  // --- Financial Health Score ---
  const healthComponents = [
    input.debtToEquity !== undefined ? invertPercentile(input.debtToEquity, 3, 0) : undefined,
    input.interestCoverage !== undefined ? Math.max(0, Math.min(100, input.interestCoverage * 10)) : undefined,
    input.currentRatio !== undefined ? Math.max(0, Math.min(100, (input.currentRatio - 0.5) * 66)) : undefined,
    input.freeCashFlow !== undefined && input.operatingCashFlow !== undefined && input.operatingCashFlow > 0
      ? 70
      : input.freeCashFlow !== undefined && input.freeCashFlow > 0
        ? 55
        : undefined,
  ].filter((v): v is number => v !== undefined);

  const financialHealthScore = healthComponents.length > 0
    ? healthComponents.reduce((s, v) => s + v, 0) / healthComponents.length
    : undefined;

  // --- Risk Score (inverted — higher risk = lower score) ---
  const riskComponents = [
    input.debtToEquity !== undefined ? invertPercentile(input.debtToEquity, 3, 0) : undefined,
    input.interestCoverage !== undefined ? Math.max(0, Math.min(100, input.interestCoverage * 10)) : undefined,
    input.currentRatio !== undefined && input.currentRatio < 1 ? 20 : input.currentRatio !== undefined && input.currentRatio < 1.5 ? 45 : undefined,
  ].filter((v): v is number => v !== undefined);

  const riskScore = riskComponents.length > 0
    ? riskComponents.reduce((s, v) => s + v, 0) / riskComponents.length
    : undefined;

  // --- Overall ---
  const components = [
    qualityScore,
    valuationScore,
    growthScore,
    momentumScore,
    financialHealthScore,
    riskScore,
  ].filter((v): v is number => v !== undefined);

  const overallScore = components.length > 0
    ? components.reduce((s, v) => s + v, 0) / components.length
    : undefined;

  // --- Strengths and risks (raw value thresholds) ---
  // Strengths use raw-value thresholds (e.g., ROE >= 0.20 is "high")
  const HIGH_ROE = 0.20;
  const HIGH_ROCE = 0.18;
  const HIGH_REVENUE_GROWTH = 0.10;
  const HIGH_EPS_GROWTH = 0.10;
  const HIGH_NET_MARGIN = 0.15;
  const HIGH_FCF_YIELD = 0.05;
  const HIGH_EARNINGS_YIELD = 0.05;
  const LOW_DTE = 0.5;
  const LOW_INTEREST_COVERAGE = 2;
  const LOW_CURRENT_RATIO = 1.0;
  const HIGH_CURRENT_RATIO = 1.5;
  const HIGH_DEBT_TO_EQUITY = 2;

  const strengths: string[] = [];
  const risks: string[] = [];

  if (input.roe !== undefined && input.roe >= HIGH_ROE) strengths.push("High ROE");
  if (input.roce !== undefined && input.roce >= HIGH_ROCE) strengths.push("Strong ROCE");
  if (input.revenueGrowth !== undefined && input.revenueGrowth >= HIGH_REVENUE_GROWTH) strengths.push("Growing revenue");
  if (input.epsGrowth !== undefined && input.epsGrowth >= HIGH_EPS_GROWTH) strengths.push("Growing earnings");
  if (input.netMargin !== undefined && input.netMargin >= HIGH_NET_MARGIN) strengths.push("High net margin");
  if (input.freeCashFlowYield !== undefined && input.freeCashFlowYield >= HIGH_FCF_YIELD) strengths.push("Strong FCF yield");
  if (input.earningsYield !== undefined && input.earningsYield >= HIGH_EARNINGS_YIELD) strengths.push("Attractive earnings yield");
  if (input.macdTrend === "bullish") strengths.push("Bullish MACD trend");
  if (input.priceChange3m !== undefined && input.priceChange3m >= 0.05) strengths.push("Positive 3M momentum");
  if (input.priceChange1y !== undefined && input.priceChange1y >= 0.10) strengths.push("Positive 1Y momentum");

  if (input.roe !== undefined && input.roe <= 0.05) risks.push("Low ROE");
  if (input.revenueGrowth !== undefined && input.revenueGrowth <= 0) risks.push("Declining revenue");
  if (input.epsGrowth !== undefined && input.epsGrowth <= 0) risks.push("Declining earnings");
  if (input.currentRatio !== undefined && input.currentRatio < LOW_CURRENT_RATIO) risks.push("Weak current ratio");
  if (input.debtToEquity !== undefined && input.debtToEquity > HIGH_DEBT_TO_EQUITY) risks.push("High debt to equity");
  if (input.interestCoverage !== undefined && input.interestCoverage < LOW_INTEREST_COVERAGE) risks.push("Low interest coverage");
  if (input.macdTrend === "bearish") risks.push("Bearish MACD trend");
  if (input.priceChange3m !== undefined && input.priceChange3m <= -0.05) risks.push("Negative 3M momentum");
  if (input.priceChange1y !== undefined && input.priceChange1y <= -0.10) risks.push("Negative 1Y momentum");

  const provenance = [
    `Inputs: ${present.length}/${present.length + missing.length} fields`,
    "Calculation: deterministic percentile-normalisation v1.0",
    "Source: stored fundamentals and verified quotes",
  ];

  const asOf = input.asOf ?? new Date().toISOString();

  const qClamped = clampScore(qualityScore);
  const vClamped = clampScore(valuationScore);
  const gClamped = clampScore(growthScore);
  const mClamped = clampScore(momentumScore);
  const fClamped = clampScore(financialHealthScore);
  const rClamped = clampScore(riskScore);
  const oClamped = clampScore(overallScore);
  const confClamped = Math.round(confidenceScore * 100) / 100;
  const covClamped = Math.round(inputCoverage * 100) / 100;

  return {
    quality: qClamped,
    valuation: vClamped,
    growth: gClamped,
    momentum: mClamped,
    financialHealth: fClamped,
    risk: rClamped,
    overall: oClamped,
    confidence: confClamped,
    coverage: covClamped,
    methodVersion: "1.0.0",
    qualityScore: qClamped,
    valuationScore: vClamped,
    growthScore: gClamped,
    momentumScore: mClamped,
    financialHealthScore: fClamped,
    riskScore: rClamped,
    overallScore: oClamped,
    confidenceScore: confClamped,
    inputCoverage: covClamped,
    strengths,
    risks,
    missingInputs: missing,
    asOf,
    provenance,
  };
}
