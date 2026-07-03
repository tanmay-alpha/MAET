/**
 * Financial Metrics Library
 * Implements key financial ratios and metrics for Indian market stocks
 */

// Valuation Ratios
export interface ValuationRatios {
  pe: number | null;           // Price to Earnings
  pb: number | null;           // Price to Book
  ps: number | null;           // Price to Sales
  evEbitda: number | null;     // Enterprise Value / EBITDA
  evRevenue: number | null;    // EV / Revenue
  mcap: number;                // Market Capitalization
  divYield: number | null;     // Dividend Yield %
}

// Profitability Ratios
export interface ProfitabilityRatios {
  roe: number | null;          // Return on Equity
  roa: number | null;          // Return on Assets
  roce: number | null;         // Return on Capital Employed
  grossMargin: number | null;  // Gross Margin %
  opMargin: number | null;     // Operating Margin %
  netMargin: number | null;    // Net Profit Margin %
  eps: number | null;          // Earnings Per Share
}

// Leverage Ratios
export interface LeverageRatios {
  debtEquity: number | null;   // Debt / Equity
  currentRatio: number | null; // Current Ratio
  quickRatio: number | null;   // Quick Ratio
  interestCov: number | null;  // Interest Coverage
  debtAssets: number | null;   // Debt / Assets
}

// Growth Metrics
export interface GrowthMetrics {
  revenueGrowth: number | null;  // Revenue Growth %
  profitGrowth: number | null;   // Net Profit Growth %
  epsGrowth: number | null;      // EPS Growth %
  cagr3Y: number | null;         // 3-Year Revenue CAGR
  cagr5Y: number | null;         // 5-Year Revenue CAGR
}

// Efficiency Ratios
export interface EfficiencyRatios {
  assetTurnover: number | null;   // Asset Turnover
  inventoryTurnover: number | null;
  receivablesTurnover: number | null;
  workingCapital: number | null;
  fixedAssetTurnover: number | null;
}

// Complete Financial Profile
export interface FinancialProfile {
  symbol: string;
  companyName: string;
  exchange: string;
  sector: string;
  industry: string;
  valuation: ValuationRatios;
  profitability: ProfitabilityRatios;
  leverage: LeverageRatios;
  growth: GrowthMetrics;
  efficiency: EfficiencyRatios;
  lastUpdated: string;
}

// Calculate PE Ratio
export function calculatePE(price: number, eps: number): number | null {
  if (eps === 0) return null;
  return price / eps;
}

// Calculate PB Ratio
export function calculatePB(marketCap: number, bookValue: number): number | null {
  if (bookValue === 0) return null;
  return marketCap / bookValue;
}

// Calculate ROE
export function calculateROE(netProfit: number, shareholderEquity: number): number | null {
  if (shareholderEquity === 0) return null;
  return (netProfit / shareholderEquity) * 100;
}

// Calculate Debt to Equity
export function calculateDebtEquity(totalDebt: number, equity: number): number | null {
  if (equity === 0) return null;
  return totalDebt / equity;
}

// Calculate Current Ratio
export function calculateCurrentRatio(currentAssets: number, currentLiabilities: number): number | null {
  if (currentLiabilities === 0) return null;
  return currentAssets / currentLiabilities;
}

// Calculate Interest Coverage
export function calculateInterestCoverage(ebit: number, interestExpense: number): number | null {
  if (interestExpense === 0) return null;
  return ebit / interestExpense;
}

// Calculate CAGR
export function calculateCAGR(startValue: number, endValue: number, years: number): number | null {
  if (startValue === 0 || years === 0) return null;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

// Format ratio for display
export function formatRatio(value: number | null, suffix = ""): string {
  if (value === null) return "N/A";
  return `${value.toFixed(2)}${suffix}`;
}

// Format percentage
export function formatPercent(value: number | null): string {
  if (value === null) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

// Format currency in Crores
export function formatCrores(value: number): string {
  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(2)}L Cr`;
  }
  return `₹${(value / 10000000).toFixed(2)} Cr`;
}

// Get ratio status (good/bad/neutral)
export function getRatioStatus(
  ratio: "pe" | "pb" | "debtEquity" | "currentRatio" | "roe",
  value: number | null,
  sectorAvg?: Record<string, number>
): "good" | "bad" | "neutral" {
  if (value === null) return "neutral";

  const thresholds: Record<string, { good: [number, number]; bad: [number, number] }> = {
    pe: { good: [10, 25], bad: [40, Infinity] },
    pb: { good: [1, 3], bad: [5, Infinity] },
    debtEquity: { good: [0, 1], bad: [2, Infinity] },
    currentRatio: { good: [1.5, Infinity], bad: [0, 1] },
    roe: { good: [15, Infinity], bad: [0, 5] },
  };

  const t = thresholds[ratio];
  if (!t) return "neutral";

  if (value >= t.good[0] && value <= t.good[1]) return "good";
  if (value >= t.bad[0] || value <= t.bad[1]) return "bad";
  return "neutral";
}
