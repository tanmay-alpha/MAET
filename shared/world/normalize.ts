import type { EventCategory, WorldEvent } from "./contracts";

/**
 * Pure upstream payload normalisers shared by the server adapters and the browser fallback,
 * so a source parsed on either side yields identical events.
 */

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function webUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function date(value: unknown): string | undefined {
  if (typeof value !== "string" && !finite(value)) return undefined;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}
export function coordinates(value: unknown): WorldEvent["coordinates"] {
  if (!Array.isArray(value)) return undefined;
  const [longitude, latitude] = value;
  return finite(longitude) &&
    finite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? { longitude, latitude }
    : undefined;
}
export function rows(value: unknown, key: string): unknown[] {
  const result = object(value)[key];
  if (!Array.isArray(result)) throw new Error(`Invalid ${key} payload`);
  return result;
}
export function usable<T>(input: unknown[], result: T[], source: string): T[] {
  if (input.length && !result.length)
    throw new Error(`Invalid ${source} payload: no usable records`);
  return result;
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
