import type { WorldEventsResponse, WorldMacroResponse } from "../../../shared/world/contracts";

export const WORLD_EVENTS: WorldEventsResponse = {
  events: [
    {
      id: "usgs:test-japan",
      title: "M 5.2 — offshore Japan",
      category: "earthquake",
      source: "USGS",
      url: "https://earthquake.usgs.gov/",
      occurredAt: "2026-11-07T06:00:00.000Z",
      coordinates: { longitude: 141, latitude: 37 },
      magnitude: 5.2,
    },
  ],
  sources: [
    { source: "USGS", fetchedAt: "2026-11-07T06:30:00.000Z", stale: false },
    { source: "NASA EONET", fetchedAt: "2026-11-07T06:30:00.000Z", stale: false },
  ],
};
export const WORLD_NEWS: WorldEventsResponse = {
  events: [
    {
      id: "gdelt:test-shipping",
      title: "Red Sea shipping disruption raises freight costs",
      category: "news",
      source: "GDELT",
      url: "https://www.reuters.com/",
      occurredAt: "2026-11-07T07:00:00.000Z",
      domain: "reuters.com",
      country: "United Kingdom",
    },
  ],
  sources: [{ source: "GDELT", fetchedAt: "2026-11-07T07:15:00.000Z", stale: false }],
};
export const WORLD_MACRO: WorldMacroResponse = {
  points: [
    { countryCode: "IND", country: "India", indicator: "gdpGrowth", value: 6.5, year: 2024 },
    { countryCode: "IND", country: "India", indicator: "cpi", value: 4.9, year: 2024 },
    {
      countryCode: "USA",
      country: "United States",
      indicator: "gdpGrowth",
      value: 2.8,
      year: 2024,
    },
    { countryCode: "USA", country: "United States", indicator: "cpi", value: 2.9, year: 2024 },
  ],
  sources: [{ source: "World Bank", fetchedAt: "2026-11-07T05:00:00.000Z", stale: false }],
};

/**
 * Trimmed upstream payloads the browser fallback reads straight from NASA EONET and GDELT.
 * Dates are relative to the browser's clock because EONET keeps only the last seven days.
 */
export function eonetUpstream(now = Date.now()) {
  return {
    title: "EONET Events",
    events: [
      {
        id: "EONET_E2E_1",
        title: "Tropical Cyclone Dana",
        description: "Bay of Bengal",
        link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_E2E_1",
        closed: null,
        categories: [{ id: "severeStorms", title: "Severe Storms" }],
        geometry: [
          {
            magnitudeValue: 55,
            magnitudeUnit: "kts",
            date: new Date(now - 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
            type: "Point",
            coordinates: [88.4, 16.2],
          },
        ],
      },
    ],
  };
}

export function gdeltUpstream(now = Date.now()) {
  const seen = new Date(now - 3_600_000).toISOString().replace(/[-:]|\.\d{3}/g, "");
  return {
    articles: [
      {
        url: "https://www.example-news.com/markets/fed-policy-rate",
        url_mobile: "",
        title: "Federal Reserve holds policy rate as inflation cools",
        seendate: seen,
        socialimage: "",
        domain: "example-news.com",
        language: "English",
        sourcecountry: "United States",
      },
    ],
  };
}
