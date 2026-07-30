import {
  ALL_CAPABILITIES,
  type CapabilityKey,
  type CapabilityState,
} from "./contracts";

interface CapabilityInputs {
  hasAuthenticatedSession: boolean;
  schemaAvailable: boolean;
}

/**
 * Evaluate the canonical state of every declared capability.
 *
 * Each capability uses the same input set but applies its own availability
 * rules. A capability that depends on authenticated data is unavailable when
 * the caller is not signed in; a capability that depends on a verified
 * external provider stays disabled until the provider is connected.
 */
export function evaluateCapabilities(
  input: CapabilityInputs
): CapabilityState[] {
  const out: CapabilityState[] = [];

  for (const key of ALL_CAPABILITIES) {
    out.push(evaluateOne(key, input));
  }

  return out;
}

function evaluateOne(
  key: CapabilityKey,
  input: CapabilityInputs
): CapabilityState {
  switch (key) {
    case "cloudWorkspace":
      return {
        key,
        available: input.hasAuthenticatedSession && input.schemaAvailable,
        reason: !input.hasAuthenticatedSession
          ? "Cloud workspace requires sign in"
          : !input.schemaAvailable
            ? "Cloud workspace requires migration 0013"
            : undefined,
      };
    case "alertEngine":
      return {
        key,
        available: input.hasAuthenticatedSession && input.schemaAvailable,
        reason: !input.hasAuthenticatedSession
          ? "Server alerts require sign in"
          : !input.schemaAvailable
            ? "Server alerts require migration 0013"
            : undefined,
      };
    case "scorecard":
      return {
        key,
        available: input.schemaAvailable,
        reason: input.schemaAvailable
          ? undefined
          : "Scorecard requires fundamentals data",
      };
    case "peerComparison":
      return {
        key,
        available: input.schemaAvailable,
        reason: input.schemaAvailable
          ? undefined
          : "Peer comparison requires company sector mapping",
      };
    case "dynamicHeatmap":
      return {
        key,
        available: input.schemaAvailable,
        reason: input.schemaAvailable
          ? undefined
          : "Dynamic heatmap requires stored quote snapshots",
      };
    case "naturalLanguageScreener":
      return {
        key,
        available: true,
        reason: undefined,
      };
    case "backtestV2":
      return {
        key,
        available: input.schemaAvailable,
        reason: input.schemaAvailable
          ? undefined
          : "Backtest V2 requires strategy registry",
      };
    case "dataQuality":
      return {
        key,
        available: input.hasAuthenticatedSession && input.schemaAvailable,
        reason: !input.hasAuthenticatedSession
          ? "Data quality centre requires admin sign in"
          : !input.schemaAvailable
            ? "Data quality centre requires ingestion_runs"
            : undefined,
      };
    case "portfolioAnalytics":
      return {
        key,
        available: input.hasAuthenticatedSession && input.schemaAvailable,
        reason: !input.hasAuthenticatedSession
          ? "Portfolio analytics requires sign in"
          : !input.schemaAvailable
            ? "Portfolio analytics requires portfolio_snapshots"
            : undefined,
      };
    case "researchTimeline":
      return {
        key,
        available: input.hasAuthenticatedSession && input.schemaAvailable,
        reason: !input.hasAuthenticatedSession
          ? "Research timeline requires sign in"
          : !input.schemaAvailable
            ? "Research timeline requires research_notes"
            : undefined,
      };
    case "derivatives":
      return {
        key,
        available: false,
        reason: "No verified derivatives provider connected",
      };
    case "liveNews":
      return {
        key,
        available: false,
        reason: "No verified news provider connected",
      };
    default: {
      const exhaustive: never = key;
      void exhaustive;
      return { key, available: false, reason: "Unknown capability" };
    }
  }
}