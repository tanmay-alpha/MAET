import type { EventCategory, MacroPoint, WorldEvent } from "../../../shared/world/contracts";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function webUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function date(value: unknown): string | undefined {
  if (typeof value !== "string" && !finite(value)) return undefined;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}
function coordinates(value: unknown): WorldEvent["coordinates"] {
  if (!Array.isArray(value)) return undefined;
  const [longitude, latitude] = value;
  return finite(longitude) &&
    finite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? { longitude, latitude }
    : undefined;
}
function rows(value: unknown, key: string): unknown[] {
  const result = object(value)[key];
  if (!Array.isArray(result)) throw new Error(`Invalid ${key} payload`);
  return result;
}
function usable<T>(input: unknown[], result: T[], source: string): T[] {
  if (input.length && !result.length)
    throw new Error(`Invalid ${source} payload: no usable records`);
  return result;
}

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

const categories: Record<string, EventCategory> = {
  wildfires: "wildfire",
  severeStorms: "storm",
  volcanoes: "volcano",
  floods: "flood",
  earthquakes: "earthquake",
};

export function normalizeEonet(payload: unknown, now: number): WorldEvent[] {
  const input = rows(payload, "events");
  const events: WorldEvent[] = [];
  let recognized = 0;
  for (const raw of input) {
    const row = object(raw);
    const id = text(row.id);
    const title = text(row.title);
    const url = webUrl(row.link);
    const shapes = Array.isArray(row.geometry) ? row.geometry.map(object) : [];
    const latest = shapes
      .map((shape) => ({ shape, date: date(shape.date) }))
      .filter((entry): entry is { shape: Record<string, unknown>; date: string } => {
        if (!entry.date) return false;
        if (entry.shape.type === "Point") return coordinates(entry.shape.coordinates) !== undefined;
        const rings = entry.shape.coordinates;
        return (
          entry.shape.type === "Polygon" &&
          Array.isArray(rings) &&
          rings.length > 0 &&
          rings.every(
            (ring) =>
              Array.isArray(ring) &&
              ring.length >= 3 &&
              ring.every((point) => coordinates(point) !== undefined),
          )
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (
      !id ||
      !title ||
      !url ||
      !latest ||
      !Array.isArray(row.categories) ||
      !row.categories.length ||
      !row.categories.some((item) => text(object(item).id)) ||
      (row.closed !== null && !date(row.closed))
    )
      continue;
    recognized++;
    if (
      row.closed !== null ||
      Date.parse(latest.date) < now - 7 * 86_400_000 ||
      Date.parse(latest.date) > now
    )
      continue;
    const category =
      row.categories.map((item) => categories[String(object(item).id)]).find(Boolean) ?? "other";
    const location =
      latest.shape.type === "Point" ? coordinates(latest.shape.coordinates) : undefined;
    const magnitude = latest.shape.magnitudeValue;
    const description = text(row.description);
    const unit = text(latest.shape.magnitudeUnit);
    const detail = [description, finite(magnitude) && unit ? `${magnitude} ${unit}` : undefined]
      .filter(Boolean)
      .join(" · ");
    events.push({
      id: `eonet:${id}`,
      title,
      category,
      source: "NASA EONET",
      url,
      occurredAt: latest.date,
      ...(location ? { coordinates: location } : {}),
      ...(finite(magnitude) ? { magnitude } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  if (input.length && !recognized) throw new Error("Invalid NASA EONET payload: no usable records");
  return events;
}

export function normalizeGdelt(payload: unknown): WorldEvent[] {
  // A query with no matching articles returns a bare `{}`; anything else must carry `articles`.
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0
  )
    return [];
  const input = rows(payload, "articles");
  const events: WorldEvent[] = [];
  for (const raw of input) {
    const row = object(raw);
    const url = webUrl(row.url);
    const title = text(row.title);
    const compactDate = text(row.seendate);
    const match = compactDate?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const expanded = match
      ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`
      : undefined;
    const occurredAt = expanded ? date(expanded) : undefined;
    if (
      !url ||
      !title ||
      !occurredAt ||
      occurredAt !== expanded ||
      text(row.language)?.toLowerCase() !== "english"
    )
      continue;
    const country = text(row.sourcecountry);
    events.push({
      id: `gdelt:${url}`,
      title,
      category: "news",
      source: "GDELT",
      url,
      occurredAt,
      domain: new URL(url).hostname,
      ...(country ? { country } : {}),
    });
  }
  return usable(input, events, "GDELT");
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
