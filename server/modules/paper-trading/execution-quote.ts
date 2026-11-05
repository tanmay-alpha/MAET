import { loadQuote } from "../../domain/market/quote-service";
import { quoteStore } from "../../domain/market/quote-store";
import { evaluateExecutionQuote, type Tick } from "@shared/types/market";
import { paperExecutionPolicy } from "./fill-writer";

export type ExecutionQuoteLoader = (exchange: "NSE" | "BSE", symbol: string) => Promise<unknown>;

export interface ExecutionQuoteSources {
  /** Latest streamed tick for a symbol (the Angel One feed via quoteStore). */
  latestTick: (symbol: string) => Tick | undefined;
  /** The market-data layer's quote for a symbol (cache, broker, then delayed fallback). */
  fallback: (symbol: string) => Promise<unknown>;
}

/**
 * Quote for a paper MARKET fill: the streamed tick when it is on the order's exchange and
 * still executable, otherwise the market-data layer's quote. Never forces a provider
 * refetch; the caller checks the quote against the execution policy and the order's
 * exchange, so a delayed or foreign-exchange fallback is rejected there.
 */
export function createExecutionQuoteLoader(sources: ExecutionQuoteSources): ExecutionQuoteLoader {
  return async (exchange, symbol) => {
    const streamed = sources.latestTick(symbol);
    if (
      streamed &&
      streamed.exchange === exchange &&
      evaluateExecutionQuote(streamed, symbol, paperExecutionPolicy()).executable
    ) {
      return streamed;
    }
    return sources.fallback(symbol);
  };
}

export const loadExecutionQuote = createExecutionQuoteLoader({
  latestTick: (symbol) => quoteStore.get(symbol),
  fallback: (symbol) => loadQuote(symbol),
});
