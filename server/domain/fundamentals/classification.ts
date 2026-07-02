export type MarketCapBucket = "large" | "mid" | "small" | "unknown";

export type RankedCompany = {
  companyId: string;
  marketCap?: number | null;
};

export type MarketCapClassification = {
  companyId: string;
  bucket: MarketCapBucket;
  rank?: number;
  methodology: string;
};

export const RANKED_MARKET_CAP_METHODOLOGY =
  "Stored NSE universe ranked by latest verified INR market capitalisation; ranks 1-100 large, 101-250 mid, 251+ small. This is a fallback until a verified AMFI classification is ingested.";

/**
 * Indian market-cap buckets are ranking based, not fixed currency thresholds.
 * Companies without a positive stored market cap remain unknown.
 */
export function classifyByMarketCapRank(rows: RankedCompany[]): MarketCapClassification[] {
  const ranked = rows
    .filter((row): row is RankedCompany & { marketCap: number } =>
      typeof row.marketCap === "number" && Number.isFinite(row.marketCap) && row.marketCap > 0
    )
    .sort((left, right) => right.marketCap - left.marketCap || left.companyId.localeCompare(right.companyId));
  const rankByCompany = new Map(ranked.map((row, index) => [row.companyId, index + 1]));

  return rows.map((row) => {
    const rank = rankByCompany.get(row.companyId);
    if (rank === undefined) {
      return { companyId: row.companyId, bucket: "unknown", methodology: RANKED_MARKET_CAP_METHODOLOGY };
    }
    const bucket: MarketCapBucket = rank <= 100 ? "large" : rank <= 250 ? "mid" : "small";
    return { companyId: row.companyId, bucket, rank, methodology: RANKED_MARKET_CAP_METHODOLOGY };
  });
}
