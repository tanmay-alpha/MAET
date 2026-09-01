export type OptionChainQuoteView = {
  ltp: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: number | null;
  openInterest: number | null;
  netChange: string | null;
  percentChange: string | null;
  averagePrice: string | null;
  totalBuyQuantity: number | null;
  totalSellQuantity: number | null;
  bestBidPrice: string | null;
  bestBidQuantity: number | null;
  bestAskPrice: string | null;
  bestAskQuantity: number | null;
  exchangeFeedAt: string;
  exchangeTradeAt: string | null;
  receivedAt: string;
  source: string;
};

export type OptionChainGreeksView = {
  delta: string | null;
  gamma: string | null;
  theta: string | null;
  vega: string | null;
  impliedVolatility: string | null;
  tradeVolume: number | null;
  observedAt: string;
  source: string;
};

export type OptionChainContractView = {
  contractId: string;
  token: string;
  tradingSymbol: string;
  strikePrice: string;
  optionType: "CE" | "PE";
  lotSize: number;
  instrumentType: string;
  quote: OptionChainQuoteView | null;
  greeks: OptionChainGreeksView | null;
};

export type PersistedOptionExpiryView = {
  expiryDate: string;
  contractCount: number;
  latestQuoteAt: string | null;
};

export type LatestOptionChainResponse = {
  underlying: string;
  expiryDate: string;
  contracts: OptionChainContractView[];
  coverage: {
    contracts: number;
    quotes: number;
    greeks: number;
  };
  freshness: {
    oldestQuoteAt: string | null;
    newestQuoteAt: string | null;
    oldestGreekObservedAt: string | null;
    newestGreekObservedAt: string | null;
  };
};

export type ListPersistedOptionExpiriesInput = {
  underlying: string;
};

export type GetLatestOptionChainInput = {
  underlying: string;
  expiryDate: string;
};
