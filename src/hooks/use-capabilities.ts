/**
 * Frontend capabilities hook.
 *
 * Subscribes to the canonical capability state from the backend. The frontend
 * never decides feature availability on its own. When a capability is
 * unavailable, the component shows an honest unavailable state rather than
 * rendering fake content.
 */

import { useQuery } from "@tanstack/react-query";

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

export interface CapabilitiesResponse {
  capabilities: CapabilityState[];
}

const EMPTY_RESPONSE: CapabilitiesResponse = { capabilities: [] };

async function fetchCapabilities(): Promise<CapabilitiesResponse> {
  const url = "/api/trpc/capabilities.get";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return EMPTY_RESPONSE;
  }
  const json = (await res.json()) as { result?: { data?: CapabilitiesResponse } };
  return json.result?.data ?? EMPTY_RESPONSE;
}

export function useCapabilities() {
  const query = useQuery({
    queryKey: ["capabilities"],
    queryFn: fetchCapabilities,
    staleTime: 60_000,
    retry: 1,
  });

  const map = new Map<CapabilityKey, CapabilityState>();
  for (const c of query.data?.capabilities ?? []) {
    map.set(c.key, c);
  }

  return {
    capabilities: query.data?.capabilities ?? [],
    isLoading: query.isLoading,
    isAvailable: (key: CapabilityKey): boolean => map.get(key)?.available === true,
    getReason: (key: CapabilityKey): string | undefined => map.get(key)?.reason,
    refetch: query.refetch,
  };
}