import { describe, expect, it } from "bun:test";
import type { WorldEvent, WorldEventsResponse } from "@shared/world/contracts";
import { normalizeEonet, normalizeGdelt } from "@shared/world/normalize";
import { EONET_EVENTS_URL, GDELT_TOPICS, gdeltQuery } from "@shared/world/upstreams";
import {
  applyBrowserFallback,
  BROWSER_FETCH_TIMEOUT_MS,
  BROWSER_GDELT_TERMS,
  BROWSER_GDELT_URL,
  browserQueryPolicy,
  fetchFromBrowser,
  needsBrowserFallback,
} from "./world-browser-fallback";

const now = Date.parse("2026-11-07T08:00:00.000Z");
const minute = 60_000;
const hour = 60 * minute;

const quake: WorldEvent = {
  id: "usgs:a",
  title: "M 5.2 — offshore Japan",
  category: "earthquake",
  source: "USGS",
  url: "https://earthquake.usgs.gov/",
  occurredAt: "2026-11-07T06:00:00.000Z",
};
const wildfire: WorldEvent = {
  id: "eonet:b",
  title: "Wildfire",
  category: "wildfire",
  source: "NASA EONET",
  url: "https://eonet.gsfc.nasa.gov/api/v3/events/b",
  occurredAt: "2026-11-07T05:00:00.000Z",
};

const eonetPayload = {
  events: [
    {
      id: "EONET_1",
      title: "Tropical Cyclone Remal",
      link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1",
      closed: null,
      categories: [{ id: "severeStorms" }],
      geometry: [{ date: "2026-11-07T03:00:00Z", type: "Point", coordinates: [89.1, 18.2] }],
    },
  ],
};
const gdeltPayload = {
  articles: [
    {
      url: "https://www.reuters.com/world/red-sea",
      title: "Red Sea shipping disruption raises freight costs",
      seendate: "20261107T070000Z",
      language: "English",
      sourcecountry: "United Kingdom",
    },
  ],
};

function serverResponse(
  events: WorldEvent[],
  eonet: WorldEventsResponse["sources"][number],
): WorldEventsResponse {
  return {
    events,
    sources: [{ source: "USGS", fetchedAt: "2026-11-07T06:30:00.000Z", stale: false }, eonet],
  };
}
const staleEonet = {
  source: "NASA EONET",
  fetchedAt: null,
  stale: true,
  error: "fetch failed (ETIMEDOUT)",
} as const;

function respond(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("needsBrowserFallback", () => {
  it("fetches from the browser when the server marks the source stale and has none of its events", () => {
    expect(needsBrowserFallback(serverResponse([quake], staleEonet), "NASA EONET")).toBe(true);
  });

  it("keeps server data when the server still has events for the source", () => {
    const response = serverResponse([quake, wildfire], {
      ...staleEonet,
      fetchedAt: "2026-11-07T06:00:00.000Z",
    });
    expect(needsBrowserFallback(response, "NASA EONET")).toBe(false);
  });

  it("does not fetch for a fresh, legitimately empty source, a missing source or no response", () => {
    const fresh = serverResponse([quake], {
      source: "NASA EONET",
      fetchedAt: "2026-11-07T06:30:00.000Z",
      stale: false,
    });
    expect(needsBrowserFallback(fresh, "NASA EONET")).toBe(false);
    expect(needsBrowserFallback(serverResponse([], staleEonet), "GDELT")).toBe(false);
    expect(needsBrowserFallback(undefined, "NASA EONET")).toBe(false);
  });
});

describe("applyBrowserFallback", () => {
  const response = serverResponse([quake], staleEonet);
  const fetched = { events: [wildfire], fetchedAt: "2026-11-07T08:00:00.000Z" };

  it("merges browser events and reports the browser path instead of the server failure", () => {
    expect(
      applyBrowserFallback(response, "NASA EONET", { data: fetched, fetching: false }, now),
    ).toEqual({
      events: [quake, wildfire],
      sources: [
        response.sources[0]!,
        {
          source: "NASA EONET",
          fetchedAt: "2026-11-07T08:00:00.000Z",
          stale: false,
          browser: "fetched",
        },
      ],
    });
  });

  it("marks an in-flight browser attempt and keeps the server error when the attempt failed", () => {
    expect(
      applyBrowserFallback(response, "NASA EONET", { fetching: true }, now).sources[1],
    ).toEqual({
      ...staleEonet,
      browser: "fetching",
    });
    expect(
      applyBrowserFallback(
        response,
        "NASA EONET",
        { error: new Error("Failed to fetch"), fetching: false },
        now,
      ),
    ).toEqual({
      events: response.events,
      sources: response.sources,
    });
  });

  it("ignores earlier browser data once the server has the source again", () => {
    const recovered = serverResponse([quake, wildfire], {
      source: "NASA EONET",
      fetchedAt: "2026-11-07T09:00:00.000Z",
      stale: false,
    });
    expect(
      applyBrowserFallback(recovered, "NASA EONET", { data: fetched, fetching: false }, now),
    ).toEqual({ events: recovered.events, sources: recovered.sources });
    expect(applyBrowserFallback(undefined, "NASA EONET", { fetching: false }, now)).toEqual({
      events: [],
      sources: [],
    });
  });
});

describe("browser data freshness", () => {
  const response = serverResponse([quake], staleEonet);
  const fetched = { events: [wildfire], fetchedAt: new Date(now).toISOString() };
  const failed = { data: fetched, error: new Error("Failed to fetch"), fetching: false };

  it("keeps data from a failed revalidation labelled with its fetch time and the error, never as fresh", () => {
    const view = applyBrowserFallback(response, "NASA EONET", failed, now + 6 * minute);
    expect(view.events).toEqual([quake, wildfire]);
    expect(view.sources[1]).toEqual({
      source: "NASA EONET",
      fetchedAt: fetched.fetchedAt,
      stale: true,
      error: "Failed to fetch",
      browser: "fetched",
    });
  });

  it("drops natural events at six hours and GDELT headlines at 24 hours, restoring the server's error", () => {
    expect(applyBrowserFallback(response, "NASA EONET", failed, now + 6 * hour - 1).events).toEqual([
      quake,
      wildfire,
    ]);
    expect(applyBrowserFallback(response, "NASA EONET", failed, now + 6 * hour)).toEqual({
      events: response.events,
      sources: response.sources,
    });
    // Expiry does not depend on a failure being recorded: an unrevalidated tab drops it too.
    expect(
      applyBrowserFallback(response, "NASA EONET", { data: fetched, fetching: false }, now + 7 * hour),
    ).toEqual({ events: response.events, sources: response.sources });

    const news: WorldEventsResponse = {
      events: [],
      sources: [{ source: "GDELT", fetchedAt: null, stale: true, error: "Upstream request timed out" }],
    };
    const headline: WorldEvent = { ...quake, id: "gdelt:a", category: "news", source: "GDELT" };
    const headlines = { data: { events: [headline], fetchedAt: fetched.fetchedAt }, fetching: false };
    expect(applyBrowserFallback(news, "GDELT", headlines, now + 24 * hour - 1).events).toEqual([
      headline,
    ]);
    expect(applyBrowserFallback(news, "GDELT", headlines, now + 24 * hour)).toEqual(news);
  });

  it("revalidates at the server's TTL, bounds the cache and keeps GDELT's five-second spacing", () => {
    expect(browserQueryPolicy("NASA EONET", 0, now)).toMatchObject({
      staleTime: 5 * minute,
      refetchInterval: 5 * minute,
    });
    expect(browserQueryPolicy("GDELT", 0, now)).toMatchObject({
      staleTime: 15 * minute,
      refetchInterval: 15 * minute,
    });
    for (const source of ["NASA EONET", "GDELT"] as const) {
      const { gcTime } = browserQueryPolicy(source, 0, now);
      expect(gcTime).toBeGreaterThan(0);
      expect(gcTime).toBeLessThanOrEqual(30 * minute);
    }
    const again = { refetchOnMount: true, retryOnMount: true };
    const wait = { refetchOnMount: false, retryOnMount: false };
    expect(browserQueryPolicy("GDELT", now - 4_999, now)).toMatchObject(wait);
    expect(browserQueryPolicy("GDELT", now - 5_000, now)).toMatchObject(again);
    expect(browserQueryPolicy("NASA EONET", now - 1, now)).toMatchObject(again);
    // A failing source is not asked again each time the window regains focus.
    expect(browserQueryPolicy("NASA EONET", 0, now).refetchOnWindowFocus).toBe(false);
  });
});

describe("fetchFromBrowser", () => {
  it("normalises EONET with the shared server normaliser", async () => {
    const urls: string[] = [];
    const result = await fetchFromBrowser("NASA EONET", new AbortController().signal, {
      fetch: async (url) => {
        urls.push(String(url));
        return respond(JSON.stringify(eonetPayload));
      },
      now: () => now,
    });
    expect(urls).toEqual([EONET_EVENTS_URL]);
    expect(result).toEqual({
      events: normalizeEonet(eonetPayload, now),
      fetchedAt: "2026-11-07T08:00:00.000Z",
    });
    expect(result.events).toHaveLength(1);
  });

  it("asks GDELT once with a combined OR query capped at 50 records", async () => {
    const urls: string[] = [];
    const result = await fetchFromBrowser("GDELT", new AbortController().signal, {
      fetch: async (url) => {
        urls.push(String(url));
        return respond(JSON.stringify(gdeltPayload));
      },
      now: () => now,
    });
    expect(urls).toEqual([BROWSER_GDELT_URL]);
    const url = new URL(BROWSER_GDELT_URL);
    expect(url.origin).toBe("https://api.gdeltproject.org");
    expect(Number(url.searchParams.get("maxrecords"))).toBeLessThanOrEqual(50);
    expect(url.searchParams.get("query")).toBe(gdeltQuery(BROWSER_GDELT_TERMS));
    // Every server topic is represented, using only terms the server also queries.
    const serverTerms = new Set<string>(GDELT_TOPICS.flat());
    expect(BROWSER_GDELT_TERMS.every((term) => serverTerms.has(term))).toBe(true);
    for (const topic of GDELT_TOPICS)
      expect(topic.some((term) => (BROWSER_GDELT_TERMS as readonly string[]).includes(term))).toBe(
        true,
      );
    // GDELT answers longer queries with "Your query was too short or too long".
    expect(gdeltQuery(BROWSER_GDELT_TERMS).length).toBeLessThanOrEqual(180);
    expect(result.events).toEqual(normalizeGdelt(gdeltPayload));
    expect(BROWSER_FETCH_TIMEOUT_MS).toBe(25_000);
  });

  it("rejects upstream errors, plain-text GDELT notices and caller aborts", async () => {
    const signal = new AbortController().signal;
    await expect(
      fetchFromBrowser("GDELT", signal, { fetch: async () => respond("slow down", 429) }),
    ).rejects.toThrow("HTTP 429");
    await expect(
      fetchFromBrowser("GDELT", signal, {
        fetch: async () => respond("Your query was too short or too long."),
      }),
    ).rejects.toThrow("invalid JSON");
    await expect(
      fetchFromBrowser("NASA EONET", signal, { fetch: async () => respond('{"message":"x"}') }),
    ).rejects.toThrow();
    const controller = new AbortController();
    const pending = fetchFromBrowser("NASA EONET", controller.signal, {
      fetch: (_url, init) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        return promise;
      },
    });
    controller.abort(new Error("left the page"));
    await expect(pending).rejects.toThrow("left the page");
  });
});
