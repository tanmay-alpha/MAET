import { useEffect, useRef, useState } from "react";
import { Map as LibreMap, NavigationControl, Popup, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { EventCategory, WorldEvent } from "@shared/world/contracts";
import { CATEGORY_LABEL, CATEGORY_TOKEN, eventMeasure } from "./event-tables";
import { formatIST, formatISTDate } from "./panel";

interface MapProps {
  events: readonly WorldEvent[];
  visible: ReadonlySet<EventCategory>;
  selectedId: string | null;
}

function collection(events: readonly WorldEvent[], visible: ReadonlySet<EventCategory>) {
  return {
    type: "FeatureCollection" as const,
    features: events.flatMap((event) =>
      event.coordinates && visible.has(event.category)
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [event.coordinates.longitude, event.coordinates.latitude],
              },
              properties: {
                id: event.id,
                category: event.category,
                // EONET magnitudes use per-category units (acres, knots), so only quakes scale.
                magnitude: event.category === "earthquake" ? (event.magnitude ?? 0) : 0,
              },
            },
          ]
        : [],
    ),
  };
}

function popupFor(event: WorldEvent, map: LibreMap) {
  if (!event.coordinates) return null;
  const content = document.createElement("div");
  content.className = "space-y-1 text-xs text-foreground";
  const title = document.createElement("strong");
  title.textContent = event.title;
  const detail = document.createElement("p");
  detail.className = "text-muted-foreground";
  detail.textContent = [
    event.source,
    `${formatISTDate(event.occurredAt)} ${formatIST(event.occurredAt)} IST`,
    eventMeasure(event),
  ]
    .filter(Boolean)
    .join(" · ");
  const link = document.createElement("a");
  link.href = event.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "text-primary underline";
  link.textContent = "Open source ↗";
  content.append(title, detail, link);
  return new Popup({ maxWidth: "280px", offset: 10 })
    .setLngLat([event.coordinates.longitude, event.coordinates.latitude])
    .setDOMContent(content)
    .addTo(map);
}

export default function WorldMap({ events, visible, selectedId }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const latest = useRef({ events, visible });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    latest.current = { events, visible };
  }, [events, visible]);

  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      instance = new LibreMap({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/dark",
        center: [65, 22],
        zoom: 1.3,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // Tile or glyph hiccups after the style has loaded are not a failed map.
    let loaded = false;
    instance.on("error", () => {
      if (!loaded) setFailed(true);
    });
    instance.on("load", () => {
      const css = getComputedStyle(document.documentElement);
      // MapLibre's canvas accepts RGB; the app's tokens use OKLCH.
      const color = (token: string) => {
        const probe = document
          .createElement("canvas")
          .getContext("2d", { willReadFrequently: true });
        if (!probe) return "transparent";
        probe.fillStyle = css.getPropertyValue(token).trim();
        probe.fillRect(0, 0, 1, 1);
        const [red, green, blue] = probe.getImageData(0, 0, 1, 1).data;
        return `rgb(${red}, ${green}, ${blue})`;
      };
      instance.addSource("world-events", {
        type: "geojson",
        data: collection(latest.current.events, latest.current.visible),
      });
      for (const category of Object.keys(CATEGORY_TOKEN) as EventCategory[]) {
        instance.addLayer({
          id: `world-${category}`,
          source: "world-events",
          type: "circle",
          filter: ["==", ["get", "category"], category],
          paint: {
            "circle-color": color(CATEGORY_TOKEN[category]),
            "circle-opacity": 0.8,
            "circle-stroke-color": color("--background"),
            "circle-stroke-width": 1,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "magnitude"],
              0,
              4,
              4.5,
              5,
              6,
              9,
              8,
              17,
            ],
          },
        });
        instance.on("click", `world-${category}`, (event) => {
          const id: unknown = event.features?.[0]?.properties?.id;
          const match = latest.current.events.find((entry) => entry.id === id);
          if (match) {
            popup.current?.remove();
            popup.current = popupFor(match, instance);
          }
        });
        instance.on("mouseenter", `world-${category}`, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", `world-${category}`, () => {
          instance.getCanvas().style.cursor = "";
        });
      }
      loaded = true;
      setFailed(false);
      setReady(true);
    });
    return () => {
      popup.current?.remove();
      instance.remove();
      map.current = null;
      setReady(false);
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("world-events") as GeoJSONSource | undefined)?.setData(
      collection(events, visible),
    );
  }, [events, visible, ready]);

  useEffect(() => {
    const event = events.find((entry) => entry.id === selectedId);
    if (!event?.coordinates || !ready || !map.current) return;
    map.current.flyTo({
      center: [event.coordinates.longitude, event.coordinates.latitude],
      zoom: 4,
      essential: false,
    });
    popup.current?.remove();
    popup.current = popupFor(event, map.current);
  }, [selectedId, events, ready]);

  return (
    <div className="relative h-full" aria-label="Global event map">
      <div
        ref={container}
        className="h-full w-full [&_.maplibregl-popup-content]:bg-panel [&_.maplibregl-popup-close-button]:text-foreground"
      />
      {failed && (
        <p
          role="status"
          className="absolute left-3 right-12 top-3 rounded-sm border border-border bg-panel p-2 text-[11px] text-muted-foreground"
        >
          Map unavailable. Select events in the feed; source links remain available.{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      <div
        aria-label="Map legend"
        className="absolute bottom-8 left-2 flex max-w-64 flex-wrap gap-x-3 gap-y-1 rounded-sm border border-border bg-panel px-2 py-1.5 text-[10px] text-muted-foreground"
      >
        {[...visible]
          .filter((category) => category !== "news")
          .map((category) => (
            <span key={category} className="flex items-center gap-1">
              <span
                className="size-1.5 rounded-full"
                style={{ background: `var(${CATEGORY_TOKEN[category]})` }}
              />
              {CATEGORY_LABEL[category]}
            </span>
          ))}
        <span>Circle size = earthquake magnitude</span>
      </div>
    </div>
  );
}
