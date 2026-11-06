import type { MacroPoint, WorldEvent } from "../../../shared/world/contracts";
import {
  coordinates,
  date,
  finite,
  object,
  rows,
  text,
  usable,
  webUrl,
} from "../../../shared/world/normalize";

export function normalizeUsgs(payload: unknown): WorldEvent[] {
  if (object(payload).type !== "FeatureCollection") throw new Error("Invalid USGS payload");
  const input = rows(payload, "features");
  const events: WorldEvent[] = [];
  for (const raw of input) {
    const row = object(raw);
    const p = object(row.properties);
    const geometry = object(row.geometry);
    const id = text(row.id);
    const title = text(p.title) ?? text(p.place);
    const url = webUrl(p.url);
    const occurredAt = date(p.time);
    const location = geometry.type === "Point" ? coordinates(geometry.coordinates) : undefined;
    if (!id || !title || !url || !occurredAt || !finite(p.mag) || !location) continue;
    events.push({
      id: `usgs:${id}`,
      title,
      category: "earthquake",
      source: "USGS",
      url,
      occurredAt,
      coordinates: location,
      magnitude: p.mag,
      ...(text(p.place) ? { detail: text(p.place) } : {}),
    });
  }
  return usable(input, events, "USGS").filter((event) => event.magnitude! >= 4.5);
}

export const WORLD_BANK_INDICATORS = {
  gdpGrowth: "NY.GDP.MKTP.KD.ZG",
  cpi: "FP.CPI.TOTL.ZG",
} as const;
export const WORLD_BANK_COUNTRIES = ["IND", "USA", "CHN", "EMU", "JPN", "GBR"] as const;
const countryCodes: Record<string, string> = {
  IN: "IND",
  US: "USA",
  CN: "CHN",
  XC: "EMU",
  EMU: "EMU",
  JP: "JPN",
  GB: "GBR",
};

export function normalizeWorldBank(
  payload: unknown,
  indicator: MacroPoint["indicator"],
): MacroPoint[] {
  if (
    !Array.isArray(payload) ||
    payload.length !== 2 ||
    !Array.isArray(payload[1]) ||
    object(payload[0]).pages !== 1
  ) {
    throw new Error("Invalid World Bank payload");
  }
  const latest = new Map<string, MacroPoint>();
  for (const raw of payload[1]) {
    const row = object(raw);
    const country = object(row.country);
    const code = text(row.countryiso3code) ?? countryCodes[String(country.id)];
    const name = text(country.value);
    const year = typeof row.date === "string" && /^\d{4}$/.test(row.date) ? Number(row.date) : NaN;
    if (
      object(row.indicator).id !== WORLD_BANK_INDICATORS[indicator] ||
      !code ||
      !WORLD_BANK_COUNTRIES.includes(code as (typeof WORLD_BANK_COUNTRIES)[number]) ||
      !name ||
      !finite(row.value) ||
      !Number.isInteger(year)
    )
      continue;
    if (!latest.has(code) || latest.get(code)!.year < year)
      latest.set(code, { countryCode: code, country: name, indicator, value: row.value, year });
  }
  if (latest.size !== WORLD_BANK_COUNTRIES.length)
    throw new Error(`Invalid World Bank ${indicator} payload: missing country observations`);
  return WORLD_BANK_COUNTRIES.map((code) => latest.get(code)!);
}
