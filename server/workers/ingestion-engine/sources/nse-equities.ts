/**
 * NSE Equities Source — Company master and equity data from NSE
 */

import { getNseCompanyMaster } from "../../../data/sources/nse-company-master";
import { getLogger } from "../../../infra/logger";
import { withRetry } from "../queue/retry-policy";

const logger = getLogger("source:nse-equities");
const SOURCE_TAG = "nse";

export interface NSECompanyRecord {
  symbol: string;
  name: string;
  isin: string | null;
  exchange: "NSE";
  series: string;
  faceValue: number | null;
  marketLot: number | null;
  source_tag: string;
  ingestedAt: string;
}

let lastSyncTimestamp: Date | null = null;

export function getLastSyncTimestamp(): Date | null {
  return lastSyncTimestamp;
}

export async function fetch(): Promise<NSECompanyRecord[]> {
  try {
    const companies = await withRetry(
      () => getNseCompanyMaster(),
      "nse-equities",
      "getNseCompanyMaster"
    );

    lastSyncTimestamp = new Date();

    return companies.map((c: any) => ({
      symbol: c.symbol,
      name: c.name ?? c.companyName ?? "",
      isin: c.isin ?? null,
      exchange: "NSE",
      series: c.series ?? "EQ",
      faceValue: c.faceValue ? Number(c.faceValue) : null,
      marketLot: c.marketLot ? Number(c.marketLot) : null,
      source_tag: SOURCE_TAG,
      ingestedAt: new Date().toISOString(),
    }));
  } catch (err) {
    logger.error({ err }, "NSE equities fetch failed");
    throw err;
  }
}
