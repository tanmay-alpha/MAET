/**
 * Fundamentals Source — Financial statements and ratios from Yahoo Finance
 */

import { getYahooFundamentals } from "../../../data/sources/yahoo-fundamentals";
import { getLogger } from "../../../infra/logger";
import { withRetry } from "../queue/retry-policy";

const logger = getLogger("source:fundamentals");
const SOURCE_TAG = "yahoo";

let lastSyncTimestamp: Date | null = null;

export function getLastSyncTimestamp(): Date | null {
  return lastSyncTimestamp;
}

export interface FundamentalsRecord {
  companyId: string;
  source_tag: string;
  ingestedAt: string;
  data: Awaited<ReturnType<typeof getYahooFundamentals>>;
}

export async function fetch(symbols: string[]): Promise<FundamentalsRecord[]> {
  const results: FundamentalsRecord[] = [];

  for (const symbol of symbols) {
    try {
      const data = await withRetry(
        () => getYahooFundamentals(symbol),
        "fundamentals",
        `getYahooFundamentals:${symbol}`
      );

      if (data) {
        results.push({
          companyId: symbol,
          source_tag: SOURCE_TAG,
          ingestedAt: new Date().toISOString(),
          data,
        });
      }
    } catch (err) {
      logger.warn({ err, symbol }, "Fundamentals fetch failed — skipping symbol");
    }
  }

  lastSyncTimestamp = new Date();
  return results;
}
