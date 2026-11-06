import type {
  MacroPoint,
  SourceStatus,
  WorldEvent,
  WorldEventsResponse,
  WorldMacroResponse,
  WorldSource,
} from "../../../shared/world/contracts";
import {
  normalizeEonet,
  normalizeGdelt,
  normalizeUsgs,
  normalizeWorldBank,
  WORLD_BANK_INDICATORS,
} from "./adapters";
import { createSourceCache } from "./cache";
import { createSpacedQueue, requestJson, sleep, type WorldFetch } from "./http";

export const WORLD_URLS = {
  usgs: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
  eonet: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7",
  worldBank: "https://api.worldbank.org/v2/country/IN;US;CN;EMU;JP;GB/indicator/",
};
export const GDELT_QUERIES = [
  '(sanctions OR "trade embargo") sourcelang:english',
  '(OPEC OR "oil supply" OR "oil production") sourcelang:english',
  '(shipping OR "Red Sea" OR "Strait of Hormuz" OR "Taiwan Strait") sourcelang:english',
  '("rate decision" OR "interest rate" OR "central bank") sourcelang:english',
  '("export ban" OR "export restrictions") sourcelang:english',
  '(conflict OR war OR "military escalation") sourcelang:english',
] as const;
export const GDELT_INTERVAL_MS = 15 * 60_000;
export const GDELT_SPACING_MS = 5_000;

function aggregateStatus(source: WorldSource, components: SourceStatus[]): SourceStatus {
  // Queries still waiting for their first attempt have neither data nor a failure to report.
  const statuses = components.filter(
    (status) => status.fetchedAt !== null || status.error !== undefined,
  );
  const timestamps = statuses.flatMap((status) =>
    status.fetchedAt === null ? [] : [status.fetchedAt],
  );
  const errors = [...new Set(statuses.flatMap((status) => (status.error ? [status.error] : [])))];
  return {
    source,
    fetchedAt: timestamps.sort()[0] ?? null,
    stale: statuses.some((status) => status.stale),
    ...(errors.length ? { error: errors.join("; ") } : {}),
  };
}
function mergeEvents(groups: WorldEvent[][]): WorldEvent[] {
  const unique = new Map<string, WorldEvent>();
  for (const group of groups) for (const event of group) unique.set(event.id, event);
  return [...unique.values()].sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}

/** Construction is inert: only endpoint reads can start upstream work. */
export function createWorldService(
  dependencies: {
    fetch?: WorldFetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const fetcher = dependencies.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = dependencies.now ?? Date.now;
  const queue = createSpacedQueue(now, dependencies.sleep ?? sleep, GDELT_SPACING_MS);
  const usgs = createSourceCache({
    source: "USGS",
    ttlMs: 60_000,
    cooldownMs: 60_000,
    now,
    load: async () => normalizeUsgs(await requestJson(fetcher, WORLD_URLS.usgs)),
  });
  const eonet = createSourceCache({
    source: "NASA EONET",
    ttlMs: 5 * 60_000,
    cooldownMs: 60_000,
    now,
    load: async () => normalizeEonet(await requestJson(fetcher, WORLD_URLS.eonet), now()),
  });
  const news = GDELT_QUERIES.map((query) =>
    createSourceCache({
      source: "GDELT",
      ttlMs: GDELT_INTERVAL_MS,
      cooldownMs: GDELT_INTERVAL_MS,
      now,
      load: () =>
        queue(async () => {
          const params = new URLSearchParams({
            query,
            mode: "artlist",
            format: "json",
            maxrecords: "40",
            timespan: "24h",
            sort: "datedesc",
          });
          return normalizeGdelt(
            await requestJson(fetcher, `https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
              maxBytes: 1024 * 1024,
            }),
          );
        }),
    }),
  );
  const macro = (Object.keys(WORLD_BANK_INDICATORS) as MacroPoint["indicator"][]).map((indicator) =>
    createSourceCache({
      source: "World Bank",
      ttlMs: 24 * 60 * 60_000,
      cooldownMs: 5 * 60_000,
      now,
      load: async () =>
        normalizeWorldBank(
          await requestJson(
            fetcher,
            `${WORLD_URLS.worldBank}${WORLD_BANK_INDICATORS[indicator]}?format=json&per_page=100&mrnev=1`,
          ),
          indicator,
        ),
    }),
  );
  return {
    async events(): Promise<WorldEventsResponse> {
      const results = await Promise.all([usgs.read(), eonet.read()]);
      return {
        events: mergeEvents(results.map((result) => result.data)),
        sources: results.map((result) => result.status),
      };
    },
    /**
     * Answers once the first due query settles instead of waiting for the whole spaced queue
     * (six queries take at least 25 s); later queries keep refreshing and appear on the next read.
     */
    async news(): Promise<WorldEventsResponse> {
      await Promise.race(news.map((cache) => cache.read()));
      const results = news.map((cache) => cache.peek());
      return {
        events: mergeEvents(results.map((result) => result.data)),
        sources: [
          aggregateStatus(
            "GDELT",
            results.map((result) => result.status),
          ),
        ],
      };
    },
    async macro(): Promise<WorldMacroResponse> {
      const results = await Promise.all(macro.map((cache) => cache.read()));
      return {
        points: results.flatMap((result) => result.data),
        sources: [
          aggregateStatus(
            "World Bank",
            results.map((result) => result.status),
          ),
        ],
      };
    },
  };
}

export const worldService = createWorldService();
