/**
 * Response shape of paperTrading.portfolioAnalytics. Kept free of runtime
 * server imports so the frontend can import the types.
 */
import type { CurveAnchor, PortfolioMetrics } from "./portfolio-metrics";

export type { CurveAnchor, DrawdownResult, MetricResult, PortfolioMetrics } from "./portfolio-metrics";

/** One end-of-day (or provisional intraday) snapshot of the current account generation. */
export interface PortfolioCurvePoint {
  /** IST trading date, YYYY-MM-DD. */
  date: string;
  equity: number;
  cash: number;
  positionsMarketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesToDate: number;
  positionsCount: number;
  /** A position was valued with a price not from this session. */
  stalePrices: boolean;
  /** Distinct price sources used, comma separated; "none" without positions. */
  priceSource: string;
  /** False for an intraday snapshot the session close will still replace. */
  isFinal: boolean;
  capturedAt: string;
}

/** What the read did about the current session's snapshot. */
export type OnDemandSnapshotStatus =
  | "written"
  | "existing"
  | "no_account"
  | "generation_not_started"
  | "failed";

export interface PortfolioAnalyticsResult {
  account: { generation: number; initialCash: number; status: string } | null;
  /** Why there is nothing to show (no account), otherwise null. */
  reason: string | null;
  /** Initial cash on the date the generation began: where the curve and total return start. */
  anchor: CurveAnchor | null;
  curve: PortfolioCurvePoint[];
  metrics: PortfolioMetrics;
  onDemandSnapshot: OnDemandSnapshotStatus;
  asOf: string;
}
