import { Link } from "@tanstack/react-router";
import type { EventCategory, MacroPoint, WorldEvent } from "@shared/world/contracts";
import type { ExposureMatch } from "@shared/world/exposure-rules";
import { formatIST, formatISTDate } from "./panel";

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  earthquake: "Earthquakes",
  wildfire: "Wildfires",
  storm: "Storms",
  volcano: "Volcanoes",
  flood: "Floods",
  news: "News",
  other: "Other",
};
export const CATEGORY_TOKEN: Record<EventCategory, string> = {
  earthquake: "--bull",
  wildfire: "--bear",
  storm: "--primary",
  volcano: "--foreground",
  flood: "--bull-candle",
  news: "--muted-foreground",
  other: "--muted-foreground",
};

export function CategoryToggles({
  label,
  selected,
  onToggle,
  categories,
}: {
  label: string;
  selected: ReadonlySet<EventCategory>;
  onToggle: (category: EventCategory) => void;
  categories: readonly EventCategory[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 px-3 py-2">
      {categories.map((category) => (
        <button
          type="button"
          key={category}
          aria-pressed={selected.has(category)}
          onClick={() => onToggle(category)}
          className={`rounded-sm border px-2 py-1 text-[10px] ${selected.has(category) ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-muted"}`}
        >
          {CATEGORY_LABEL[category]}
        </button>
      ))}
    </div>
  );
}

/** Earthquake magnitude, or EONET's own description and unit (acres, knots) for other events. */
export function eventMeasure(event: WorldEvent): string | undefined {
  return event.category === "earthquake" && event.magnitude !== undefined
    ? `M${event.magnitude.toFixed(1)}`
    : event.detail;
}

export function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: WorldEvent;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <article
      className={`border-b border-border last:border-0 ${selected ? "bg-accent" : "hover:bg-muted"}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(event.id)}
        className="block w-full px-3 pb-1 pt-2 text-left text-xs leading-relaxed"
      >
        <span className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className="size-1.5 rounded-full"
            style={{ background: `var(${CATEGORY_TOKEN[event.category]})` }}
          />
          {CATEGORY_LABEL[event.category]}
          <time className="ml-auto font-mono" dateTime={event.occurredAt}>
            {formatISTDate(event.occurredAt)} {formatIST(event.occurredAt)} IST
          </time>
        </span>
        {event.title}
      </button>
      <div className="flex flex-wrap items-center gap-x-2 px-3 pb-2 text-[10px] text-muted-foreground">
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary hover:underline"
        >
          {event.domain ?? event.source} ↗
        </a>
        {eventMeasure(event) && <span>{eventMeasure(event)}</span>}
        {event.country && <span>{event.country} · publisher country</span>}
        {!event.coordinates && <span>Not mapped</span>}
      </div>
    </article>
  );
}

function WatchSymbols({ symbols }: { symbols: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      {symbols.map((symbol) => (
        <Link
          key={symbol}
          to="/stock/$symbol"
          params={{ symbol }}
          className="font-mono text-[11px] text-primary hover:underline"
        >
          {symbol}
        </Link>
      ))}
    </div>
  );
}

export function ExposureTable({
  rows,
  onSelect,
}: {
  rows: readonly ExposureMatch[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-[10px] text-muted-foreground">
            <tr>
              {["Event", "Region", "Exposure", "Rule text", "Watch symbols"].map((label) => (
                <th key={label} className="px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.event.id}-${row.ruleId}`}
                className="border-t border-border align-top hover:bg-muted/40"
              >
                <td className="min-w-44 max-w-64 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onSelect(row.event.id)}
                    className="text-left hover:text-primary"
                  >
                    {row.event.title}
                  </button>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.region}</td>
                <td className="px-3 py-2">{row.sectors.join(", ")}</td>
                <td className="min-w-56 px-3 py-2 text-muted-foreground">{row.ruleText}</td>
                <td className="min-w-36 px-3 py-2">
                  <WatchSymbols symbols={row.watchSymbols} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <li key={`${row.event.id}-${row.ruleId}`} className="space-y-2 p-3 text-xs">
            <button
              type="button"
              onClick={() => onSelect(row.event.id)}
              className="text-left font-medium hover:text-primary"
            >
              {row.event.title}
            </button>
            <p className="text-[11px] text-muted-foreground">
              {row.region} · {row.sectors.join(", ")}
            </p>
            <p className="text-[11px] text-muted-foreground">{row.ruleText}</p>
            <WatchSymbols symbols={row.watchSymbols} />
          </li>
        ))}
      </ul>
    </>
  );
}

const COUNTRIES = [
  ["IND", "India"],
  ["USA", "US"],
  ["CHN", "China"],
  ["EMU", "Euro area"],
  ["JPN", "Japan"],
  ["GBR", "UK"],
] as const;
export function MacroTable({ points }: { points: readonly MacroPoint[] }) {
  const value = (code: string, indicator: MacroPoint["indicator"]) => {
    const point = points.find(
      (entry) => entry.countryCode === code && entry.indicator === indicator,
    );
    return point ? (
      <>
        {point.value.toFixed(2)}%{" "}
        <span className="ml-2 text-[10px] text-muted-foreground">{point.year}</span>
      </>
    ) : (
      <span className="text-muted-foreground">Unavailable</span>
    );
  };
  return (
    <table className="w-full text-left text-xs">
      <thead className="bg-muted/40 text-[10px] text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Economy</th>
          <th className="px-3 py-2 text-right font-medium">GDP growth · year</th>
          <th className="px-3 py-2 text-right font-medium">CPI · year</th>
        </tr>
      </thead>
      <tbody>
        {COUNTRIES.map(([code, name]) => (
          <tr key={code} className="border-t border-border">
            <th className="px-3 py-2 font-normal">{name}</th>
            <td className="px-3 py-2 text-right font-mono tabular-nums">
              {value(code, "gdpGrowth")}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{value(code, "cpi")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
