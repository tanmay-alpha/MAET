import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { WorldEventsResponse } from "@shared/world/contracts";
import { GDELT_SPACING_MS } from "@shared/world/upstreams";
import {
  applyBrowserFallback,
  browserDataExpiresAt,
  browserQueryPolicy,
  fetchFromBrowser,
  needsBrowserFallback,
  type BrowserFallbackSource,
  type BrowserFetch,
} from "@/lib/world-browser-fallback";

/** The current time, refreshed when `boundary` passes so a render happens at that instant. */
function useTimeAfter(boundary: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (boundary === null) return;
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), boundary)),
      Math.max(0, boundary - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [boundary]);
  return now;
}

/**
 * Server events for `source`, completed by a browser fetch while the server reports the source
 * stale with nothing to show. The browser result follows the source's freshness policy: it is
 * revalidated after the server's TTL, kept but labelled when a revalidation fails, and dropped at
 * the source's max age. `retry` refetches the server and, if it still cannot read the source,
 * asks the browser again.
 */
export function useWorldBrowserFallback(
  source: BrowserFallbackSource,
  server: UseQueryResult<WorldEventsResponse>,
) {
  const needed = needsBrowserFallback(server.data, source);
  const queryKey = ["world", "browser", source];
  const previous = useQueryClient().getQueryState<BrowserFetch>(queryKey);
  // Mirrors the server's queue: GDELT's five-second gap starts when the last request settled.
  const lastSettled = Math.max(previous?.dataUpdatedAt ?? 0, previous?.errorUpdatedAt ?? 0);
  const browser = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchFromBrowser(source, signal),
    enabled: needed,
    retry: false,
    ...browserQueryPolicy(source, lastSettled, Date.now()),
  });
  const now = useTimeAfter(browser.data ? browserDataExpiresAt(source, browser.data) : null);
  const view = useMemo(
    () =>
      applyBrowserFallback(
        server.data,
        source,
        { data: browser.data, error: browser.error, fetching: browser.isFetching },
        now,
      ),
    [server.data, source, browser.data, browser.error, browser.isFetching, now],
  );
  const retry = async () => {
    const result = await server.refetch();
    if (!needsBrowserFallback(result.data, source)) return;
    if (source === "GDELT" && Date.now() - lastSettled < GDELT_SPACING_MS) return;
    await browser.refetch({ cancelRefetch: false });
  };
  return { ...view, retry };
}
