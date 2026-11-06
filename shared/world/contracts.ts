export const EVENT_CATEGORIES = [
  "earthquake",
  "wildfire",
  "storm",
  "volcano",
  "flood",
  "news",
  "other",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type WorldSource = "USGS" | "NASA EONET" | "GDELT" | "World Bank";

export interface WorldEvent {
  id: string;
  title: string;
  category: EventCategory;
  source: WorldSource;
  url: string;
  occurredAt: string;
  coordinates?: { longitude: number; latitude: number };
  magnitude?: number;
  country?: string;
  domain?: string;
  detail?: string;
}

export interface SourceStatus {
  source: WorldSource;
  fetchedAt: string | null;
  stale: boolean;
  error?: string;
}

export interface WorldEventsResponse {
  events: WorldEvent[];
  sources: SourceStatus[];
}

export interface MacroPoint {
  countryCode: string;
  country: string;
  indicator: "gdpGrowth" | "cpi";
  value: number;
  year: number;
}

export interface WorldMacroResponse {
  points: MacroPoint[];
  sources: SourceStatus[];
}
