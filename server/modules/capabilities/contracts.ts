/**
 * Capability contracts.
 *
 * Capabilities are the canonical feature-flag mechanism for advanced product
 * features. Each capability is a single string identifier with a default state.
 *
 * Capabilities are evaluated server-side based on:
 *   - schema availability (is the required table present and migrated?)
 *   - service availability (is the module wired and tested?)
 *   - environment configuration (is a verified provider connected?)
 *
 * The frontend receives the canonical state via the `capabilities.get` tRPC
 * procedure and hides or shows an honest unavailable state accordingly.
 */

export type CapabilityKey =
  | "cloudWorkspace"
  | "alertEngine"
  | "scorecard"
  | "peerComparison"
  | "dynamicHeatmap"
  | "naturalLanguageScreener"
  | "backtestV2"
  | "dataQuality"
  | "portfolioAnalytics"
  | "researchTimeline"
  | "derivatives"
  | "liveNews";

export interface CapabilityState {
  key: CapabilityKey;
  available: boolean;
  reason?: string;
}

export const ALL_CAPABILITIES: CapabilityKey[] = [
  "cloudWorkspace",
  "alertEngine",
  "scorecard",
  "peerComparison",
  "dynamicHeatmap",
  "naturalLanguageScreener",
  "backtestV2",
  "dataQuality",
  "portfolioAnalytics",
  "researchTimeline",
  "derivatives",
  "liveNews",
];