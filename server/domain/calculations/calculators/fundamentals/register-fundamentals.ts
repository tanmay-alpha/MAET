/**
 * Fundamental Calculator Registrations
 * Registers all fundamental analysis calculators into the global registry
 */

import { registerCalculator } from "../../engine/calculator-registry";
import type { CalculatorInput, CalculatorOutput } from "../../engine/calculator-registry";
import { calculateFundamentalRatios } from "../../../../domain/fundamentals/ratios";

function fundamentalOutput(
  symbol: string,
  indicatorName: string,
  value: number | undefined,
  period: string
): CalculatorOutput[] {
  if (value === undefined || !isFinite(value)) return [];
  return [{ symbol, indicatorName, date: period, value }];
}

function getFinancials(input: CalculatorInput) {
  return {
    current: {
      revenue: input.financials?.revenue ?? undefined,
      costOfRevenue: input.financials?.costOfRevenue ?? undefined,
      operatingIncome: input.financials?.operatingIncome ?? undefined,
      ebitda: input.financials?.ebitda ?? undefined,
      ebit: input.financials?.ebit ?? undefined,
      interestExpense: input.financials?.interestExpense ?? undefined,
      taxExpense: input.financials?.taxExpense ?? undefined,
      netIncome: input.financials?.netIncome ?? undefined,
      totalAssets: input.financials?.totalAssets ?? undefined,
      currentAssets: input.financials?.currentAssets ?? undefined,
      inventory: input.financials?.inventory ?? undefined,
      cashAndEquivalents: input.financials?.cashAndEquivalents ?? undefined,
      currentLiabilities: input.financials?.currentLiabilities ?? undefined,
      totalDebt: input.financials?.totalDebt ?? undefined,
      shareholdersEquity: input.financials?.shareholdersEquity ?? undefined,
      operatingCashFlow: input.financials?.operatingCashFlow ?? undefined,
      capitalExpenditure: input.financials?.capitalExpenditure ?? undefined,
      dividendsPaid: input.financials?.dividendsPaid ?? undefined,
      sharesOutstanding: input.financials?.sharesOutstanding ?? undefined,
    },
    previous: {
      revenue: input.financials?.prevRevenue ?? undefined,
      netIncome: input.financials?.prevNetIncome ?? undefined,
      shareholdersEquity: input.financials?.prevShareholdersEquity ?? undefined,
      totalAssets: input.financials?.prevTotalAssets ?? undefined,
      sharesOutstanding: input.financials?.prevSharesOutstanding ?? undefined,
    },
    market: {
      price: input.marketData?.price ?? undefined,
      marketCap: input.marketData?.marketCap ?? undefined,
      enterpriseValue: input.marketData?.enterpriseValue ?? undefined,
    },
  };
}

// ============================================================================
// Profitability Ratios
// ============================================================================

registerCalculator({
  meta: {
    name: "GROSS_MARGIN",
    displayName: "Gross Margin",
    category: "profitability",
    frequency: "quarterly",
    description: "Gross profit as % of revenue",
    requiredFields: ["financials.revenue", "financials.costOfRevenue"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "GROSS_MARGIN", ratios.grossMargin, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "OPERATING_MARGIN",
    displayName: "Operating Margin",
    category: "profitability",
    frequency: "quarterly",
    description: "Operating income as % of revenue",
    requiredFields: ["financials.revenue", "financials.operatingIncome"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "OPERATING_MARGIN", ratios.operatingMargin, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "EBITDA_MARGIN",
    displayName: "EBITDA Margin",
    category: "profitability",
    frequency: "quarterly",
    description: "EBITDA as % of revenue",
    requiredFields: ["financials.revenue", "financials.ebitda"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "EBITDA_MARGIN", ratios.ebitdaMargin, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "NET_MARGIN",
    displayName: "Net Profit Margin",
    category: "profitability",
    frequency: "quarterly",
    description: "Net income as % of revenue",
    requiredFields: ["financials.revenue", "financials.netIncome"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "NET_MARGIN", ratios.netMargin, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "ROE",
    displayName: "Return on Equity",
    category: "profitability",
    frequency: "annual",
    description: "Net income / average shareholders equity",
    requiredFields: ["financials.netIncome", "financials.shareholdersEquity"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "ROE", ratios.roe, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "ROA",
    displayName: "Return on Assets",
    category: "profitability",
    frequency: "annual",
    description: "Net income / average total assets",
    requiredFields: ["financials.netIncome", "financials.totalAssets"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "ROA", ratios.returnOnAssets, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "ROIC",
    displayName: "Return on Invested Capital",
    category: "profitability",
    frequency: "annual",
    description: "After-tax operating income / invested capital",
    requiredFields: ["financials.ebit", "financials.totalDebt", "financials.shareholdersEquity"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "ROIC", ratios.returnOnInvestedCapital, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "ROCE",
    displayName: "Return on Capital Employed",
    category: "profitability",
    frequency: "annual",
    description: "EBIT / invested capital (total assets - current liabilities)",
    requiredFields: ["financials.ebit", "financials.totalDebt", "financials.shareholdersEquity"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "ROCE", ratios.roce, input.period ?? "");
  },
});

// ============================================================================
// Valuation Ratios
// ============================================================================

registerCalculator({
  meta: {
    name: "PE_RATIO",
    displayName: "P/E Ratio",
    category: "valuation",
    frequency: "daily",
    description: "Price / EPS — only positive earnings",
    requiredFields: ["financials.netIncome", "financials.sharesOutstanding", "marketData.price"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "PE_RATIO", ratios.peRatio, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "PB_RATIO",
    displayName: "P/B Ratio",
    category: "valuation",
    frequency: "daily",
    description: "Market cap / total shareholders equity",
    requiredFields: ["financials.shareholdersEquity", "marketData.marketCap"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "PB_RATIO", ratios.pbRatio, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "EV_EBITDA",
    displayName: "EV/EBITDA",
    category: "valuation",
    frequency: "quarterly",
    description: "Enterprise value / EBITDA",
    requiredFields: ["financials.ebitda", "marketData.enterpriseValue"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "EV_EBITDA", ratios.enterpriseValueToEbitda, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "EARNINGS_YIELD",
    displayName: "Earnings Yield",
    category: "valuation",
    frequency: "quarterly",
    description: "Net income / market cap (inverse of P/E)",
    requiredFields: ["financials.netIncome", "marketData.marketCap"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "EARNINGS_YIELD", ratios.earningsYield, input.period ?? "");
  },
});

// ============================================================================
// Leverage & Health
// ============================================================================

registerCalculator({
  meta: {
    name: "DEBT_EQUITY",
    displayName: "Debt/Equity",
    category: "health",
    frequency: "quarterly",
    description: "Total debt / shareholders equity",
    requiredFields: ["financials.totalDebt", "financials.shareholdersEquity"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "DEBT_EQUITY", ratios.debtToEquity, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "CURRENT_RATIO",
    displayName: "Current Ratio",
    category: "health",
    frequency: "quarterly",
    description: "Current assets / current liabilities",
    requiredFields: ["financials.currentAssets", "financials.currentLiabilities"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "CURRENT_RATIO", ratios.currentRatio, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "QUICK_RATIO",
    displayName: "Quick Ratio",
    category: "health",
    frequency: "quarterly",
    description: "(Current assets - inventory) / current liabilities",
    requiredFields: ["financials.currentAssets", "financials.inventory", "financials.currentLiabilities"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "QUICK_RATIO", ratios.quickRatio, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "INTEREST_COVERAGE",
    displayName: "Interest Coverage",
    category: "health",
    frequency: "quarterly",
    description: "EBIT / interest expense",
    requiredFields: ["financials.ebit", "financials.interestExpense"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "INTEREST_COVERAGE", ratios.interestCoverage, input.period ?? "");
  },
});

// ============================================================================
// Growth Ratios
// ============================================================================

registerCalculator({
  meta: {
    name: "REVENUE_GROWTH",
    displayName: "Revenue Growth (YoY)",
    category: "growth",
    frequency: "annual",
    description: "Year-over-year revenue growth rate",
    requiredFields: ["financials.revenue", "financials.prevRevenue"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "REVENUE_GROWTH", ratios.revenueGrowth, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "NET_INCOME_GROWTH",
    displayName: "Net Income Growth (YoY)",
    category: "growth",
    frequency: "annual",
    description: "Year-over-year net income growth rate",
    requiredFields: ["financials.netIncome", "financials.prevNetIncome"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "NET_INCOME_GROWTH", ratios.netIncomeGrowth, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "EPS",
    displayName: "EPS",
    category: "valuation",
    frequency: "quarterly",
    description: "Earnings per share",
    requiredFields: ["financials.netIncome", "financials.sharesOutstanding"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "EPS", ratios.eps, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "FCF",
    displayName: "Free Cash Flow",
    category: "quality",
    frequency: "annual",
    description: "Operating cash flow - capex",
    requiredFields: ["financials.operatingCashFlow", "financials.capitalExpenditure"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "FCF", ratios.freeCashFlow, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "FCF_MARGIN",
    displayName: "FCF Margin",
    category: "quality",
    frequency: "annual",
    description: "Free cash flow as % of revenue",
    requiredFields: ["financials.operatingCashFlow", "financials.capitalExpenditure", "financials.revenue"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "FCF_MARGIN", ratios.freeCashFlowMargin, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "ASSET_TURNOVER",
    displayName: "Asset Turnover",
    category: "efficiency",
    frequency: "annual",
    description: "Revenue / average total assets",
    requiredFields: ["financials.revenue", "financials.totalAssets"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const { current, previous, market } = getFinancials(input);
    const ratios = calculateFundamentalRatios(current, previous, market);
    return fundamentalOutput(input.symbol, "ASSET_TURNOVER", ratios.assetTurnover, input.period ?? "");
  },
});

registerCalculator({
  meta: {
    name: "PIOTROSKI_F_SCORE",
    displayName: "Piotroski F-Score",
    category: "composite",
    frequency: "annual",
    description: "9-point financial health score (0-9)",
    requiredFields: ["financials.netIncome", "financials.operatingCashFlow", "financials.totalAssets",
                    "financials.totalDebt", "financials.currentAssets", "financials.currentLiabilities",
                    "financials.sharesOutstanding", "financials.revenue", "financials.grossMargin"],
    outputFields: ["value", "components"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const f = input.financials ?? {};

    let score = 0;
    const components: Record<string, number> = {};

    // Profitability
    components.roa = f.netIncome && f.totalAssets ? f.netIncome / f.totalAssets : 0;
    if (components.roa > 0) score++;

    components.cfo = f.operatingCashFlow ?? 0;
    if (components.cfo > 0) score++;

    const prevRoa = f.prevNetIncome && f.prevTotalAssets ? f.prevNetIncome / f.prevTotalAssets : 0;
    if (components.roa > prevRoa) score++;

    components.accrual = components.cfo - components.roa * (f.totalAssets ?? 0);
    if (components.accrual > 0) score++;

    // Leverage
    const debtRatio = f.totalDebt && f.totalAssets ? f.totalDebt / f.totalAssets : 0;
    const prevDebtRatio = f.prevTotalDebt && f.prevTotalAssets ? f.prevTotalDebt / f.prevTotalAssets : 0;
    if (debtRatio < prevDebtRatio) score++;

    const cr = f.currentAssets && f.currentLiabilities ? f.currentAssets / f.currentLiabilities : 0;
    const prevCr = f.prevCurrentAssets && f.prevCurrentLiabilities ? f.prevCurrentAssets / f.prevCurrentLiabilities : 0;
    if (cr > prevCr) score++;

    const shares = f.sharesOutstanding ?? 0;
    const prevShares = f.prevSharesOutstanding ?? 0;
    if (shares <= prevShares) score++;

    // Operating efficiency
    const gm = f.revenue && f.costOfRevenue ? (f.revenue - f.costOfRevenue) / f.revenue : 0;
    const prevGm = f.prevRevenue && f.prevCostOfRevenue ? (f.prevRevenue - f.prevCostOfRevenue) / f.prevRevenue : 0;
    if (gm > prevGm) score++;

    const at = f.revenue && f.totalAssets ? f.revenue / f.totalAssets : 0;
    const prevAt = f.prevRevenue && f.prevTotalAssets ? f.prevRevenue / f.prevTotalAssets : 0;
    if (at > prevAt) score++;

    const date = input.period ?? new Date().toISOString().split("T")[0];
    return [{ symbol: input.symbol, indicatorName: "PIOTROSKI_F_SCORE", date, value: score, components }];
  },
});

export const FUNDAMENTAL_CALCULATOR_COUNT = 21;
