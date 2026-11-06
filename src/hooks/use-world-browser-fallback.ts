import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type { WorldEventsResponse } from "@shared/world/contracts";
import { GDELT_SPACING_MS } from "@shared/world/upstreams";
import {
  applyBrowserFallback,
  fetchFromBrowser,
  needsBrowserFallback,
  type BrowserFallbackSource,
} from "@/lib/world-browser-fallback";

/**
 * Server events for `source`, completed by one browser fetch per page load when the server
 * reports the source stale with nothing to show. `retry` refetches the server and, if it still
 * cannot read the source, tries the browser again.
 */
export function useWorldBrowserFallback(
  source: BrowserFallbackSource,
  server: UseQueryResult<WorldEventsResponse>,
) {
  const needed = needsBrowserFallback(server.data, source);
  const browser = useQuery({
    queryKey: ["world", "browser", source],
    queryFn: ({ signal }) => fetchFromBrowser(source, signal),
    // Only the first attempt is automatic; the cached query outlives route changes.
    enabled: (query) => needed && query.state.dataUpdateCount + query.state.errorUpdateCount === 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const view = useMemo(
    () =>
      applyBrowserFallback(server.data, source, {
        data: browser.data,
        fetching: browser.isFetching,
      }),
    [server.data, source, browser.data, browser.isFetching],
  );
  const lastSettled = Math.max(browser.dataUpdatedAt, browser.errorUpdatedAt);
  const retry = async () => {
    const result = await server.refetch();
    if (!needsBrowserFallback(result.data, source)) return;
    // Mirrors the server's queue: GDELT's five-second gap starts when the last request settled.
    if (source === "GDELT" && Date.now() - lastSettled < GDELT_SPACING_MS) return;
    await browser.refetch({ cancelRefetch: false });
  };
  return { ...view, retry };
}
