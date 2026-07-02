export type FinancialPeriod = {
  revenue?: number;
  costOfRevenue?: number;
  operatingIncome?: number;
  ebitda?: number;
  ebit?: number;
  interestExpense?: number;
  taxExpense?: number;
  netIncome?: number;
  totalAssets?: number;
  currentAssets?: number;
  inventory?: number;
  cashAndEquivalents?: number;
  currentLiabilities?: number;
  totalDebt?: number;
  shareholdersEquity?: number;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  dividendsPaid?: number;
  sharesOutstanding?: number;
};

export type MarketInputs = {
  price?: number;
  marketCap?: number;
  enterpriseValue?: number;
};

export type FundamentalRatios = {
  grossMargin?: number;
  operatingMargin?: number;
  ebitdaMargin?: number;
  netMargin?: number;
  roe?: number;
  returnOnAssets?: number;
  returnOnInvestedCapital?: number;
  roce?: number;
  currentRatio?: number;
  quickRatio?: number;
  debtToEquity?: number;
  interestCoverage?: number;
  assetTurnover?: number;
  eps?: number;
  peRatio?: number;
  pbRatio?: number;
  revenueGrowth?: number;
  netIncomeGrowth?: number;
  epsGrowth?: number;
  freeCashFlow?: number;
  freeCashFlowMargin?: number;
  payoutRatio?: number;
  earningsYield?: number;
  freeCashFlowYield?: number;
  enterpriseValueToEbitda?: number;
};

function ratio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : undefined;
}

function average(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined) return previous;
  if (previous === undefined) return current;
  return (current + previous) / 2;
}

function growth(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

/** Ratios are returned as decimals (0.15 means 15%), never display-rounded. */
export function calculateFundamentalRatios(
  current: FinancialPeriod,
  previous: FinancialPeriod = {},
  market: MarketInputs = {}
): FundamentalRatios {
  const grossProfit = current.revenue !== undefined && current.costOfRevenue !== undefined
    ? current.revenue - current.costOfRevenue
    : undefined;
  const freeCashFlow = current.operatingCashFlow !== undefined && current.capitalExpenditure !== undefined
    ? current.operatingCashFlow - Math.abs(current.capitalExpenditure)
    : undefined;
  const eps = ratio(current.netIncome, current.sharesOutstanding);
  const previousEps = ratio(previous.netIncome, previous.sharesOutstanding);
  const averageAssets = average(current.totalAssets, previous.totalAssets);
  const averageEquity = average(current.shareholdersEquity, previous.shareholdersEquity);
  const investedCapital = current.totalDebt !== undefined && current.shareholdersEquity !== undefined && current.cashAndEquivalents !== undefined
    ? current.totalDebt + current.shareholdersEquity - current.cashAndEquivalents
    : undefined;
  const afterTaxOperatingIncome = current.ebit !== undefined
    ? current.ebit - Math.max(0, current.taxExpense ?? 0)
    : undefined;

  const roce = ratio(current.ebit, investedCapital);
  const peRatio = eps !== undefined && eps > 0 ? ratio(market.price, eps) : undefined;

  return {
    grossMargin: ratio(grossProfit, current.revenue),
    operatingMargin: ratio(current.operatingIncome, current.revenue),
    ebitdaMargin: ratio(current.ebitda, current.revenue),
    netMargin: ratio(current.netIncome, current.revenue),
    roe: ratio(current.netIncome, averageEquity),
    returnOnAssets: ratio(current.netIncome, averageAssets),
    returnOnInvestedCapital: ratio(afterTaxOperatingIncome, investedCapital),
    roce,
    currentRatio: ratio(current.currentAssets, current.currentLiabilities),
    quickRatio: ratio(
      current.currentAssets !== undefined ? current.currentAssets - (current.inventory ?? 0) : undefined,
      current.currentLiabilities
    ),
    debtToEquity: ratio(current.totalDebt, current.shareholdersEquity),
    interestCoverage: ratio(current.ebit, current.interestExpense !== undefined ? Math.abs(current.interestExpense) : undefined),
    assetTurnover: ratio(current.revenue, averageAssets),
    eps,
    // A negative or zero EPS has no meaningful conventional P/E.
    peRatio,
    pbRatio: ratio(market.marketCap, current.shareholdersEquity),
    revenueGrowth: growth(current.revenue, previous.revenue),
    netIncomeGrowth: growth(current.netIncome, previous.netIncome),
    epsGrowth: growth(eps, previousEps),
    freeCashFlow,
    freeCashFlowMargin: ratio(freeCashFlow, current.revenue),
    payoutRatio: ratio(current.dividendsPaid !== undefined ? Math.abs(current.dividendsPaid) : undefined, current.netIncome),
    earningsYield: ratio(current.netIncome, market.marketCap),
    freeCashFlowYield: ratio(freeCashFlow, market.marketCap),
    enterpriseValueToEbitda: ratio(market.enterpriseValue, current.ebitda),
  };
}
