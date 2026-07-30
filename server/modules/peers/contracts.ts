/**
 * Peer comparison contracts.
 *
 * Peer selection is deterministic:
 *   1. Same industry
 *   2. Same sector (broader fallback)
 *   3. Closest verified market cap
 *   4. Maximum 10 peers
 *   5. Exclude companies with insufficient identity data
 */

import { z } from "zod";

export const PeerComparisonRequestSchema = z.object({
  symbol: z.string().min(1).max(20),
  limit: z.number().int().positive().max(10).default(5),
});
export type PeerComparisonRequest = z.infer<typeof PeerComparisonRequestSchema>;

export const PeerMetricSchema = z.object({
  marketCap: z.number().optional(),
  peRatio: z.number().optional(),
  pbRatio: z.number().optional(),
  enterpriseValueToEbitda: z.number().optional(),
  roe: z.number().optional(),
  roce: z.number().optional(),
  revenueGrowth: z.number().optional(),
  epsGrowth: z.number().optional(),
  netMargin: z.number().optional(),
  debtToEquity: z.number().optional(),
  freeCashFlowYield: z.number().optional(),
  relativeVolume: z.number().optional(),
  priceMomentum3m: z.number().optional(),
  priceMomentum1y: z.number().optional(),
});
export type PeerMetric = z.infer<typeof PeerMetricSchema>;

export const PeerComparisonEntrySchema = z.object({
  symbol: z.string(),
  name: z.string(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  marketCap: z.number().nullable(),
  isTarget: z.boolean(),
  rank: z.number().int(),
  percentile: z.number(),
  metrics: PeerMetricSchema,
  dataCoverage: z.number(),
});
export type PeerComparisonEntry = z.infer<typeof PeerComparisonEntrySchema>;

export const PeerComparisonResultSchema = z.object({
  target: PeerComparisonEntrySchema,
  peers: z.array(PeerComparisonEntrySchema),
  medians: PeerMetricSchema,
  sectorMedian: PeerMetricSchema.partial(),
  asOf: z.string(),
});
export type PeerComparisonResult = z.infer<typeof PeerComparisonResultSchema>;