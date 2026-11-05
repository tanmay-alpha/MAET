import { loadQuote } from "../../domain/market/quote-service";
import { quoteStore } from "../../domain/market/quote-store";
import { evaluateExecutionQuote } from "@shared/types/market";
import { paperExecutionPolicy } from "./fill-writer";

export type ExecutionQuoteLoader = (exchange: "NSE" | "BSE", symbol: string) => Promise<unknown>;

/**
 * Quote for a paper MARKET fill: the streamed Angel One tick for the order's exchange when it
 * is still executable, otherwise whatever the market-data layer serves for the symbol (cache,
 * broker, then delayed fallback). Never forces a provider refetch; the caller checks the quote
 * against the execution policy and the order's exchange, so delayed quotes are rejected there.
 */
export const loadExecutionQuote: ExecutionQuoteLoader = async (exchange, symbol) => {
  const streamed = quoteStore.get(symbol);
  if (
    streamed &&
    streamed.exchange === exchange &&
    evaluateExecutionQuote(streamed, symbol, paperExecutionPolicy()).executable
  ) {
    return streamed;
  }
  return loadQuote(symbol);
};
