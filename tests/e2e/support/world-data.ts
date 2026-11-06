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
