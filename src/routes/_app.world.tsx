import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import {
  EVENT_CATEGORIES,
  type EventCategory,
  type WorldEventsResponse,
  type WorldMacroResponse,
} from "@shared/world/contracts";
import { matchExposure } from "@shared/world/exposure-rules";
import { apiUrl } from "@/lib/api-url";
import {
  CategoryToggles,
  EventRow,
  ExposureTable,
  MacroTable,
} from "@/components/world/event-tables";
import { MarketStrip } from "@/components/world/market-strip";
import {
  EmptyLine,
  QueryError,
  SkeletonRows,
  SourceWarnings,
  WorldPanel,
} from "@/components/world/panel";

const WorldMap = lazy(() => import("@/components/world/world-map"));
const MAP_CATEGORIES = EVENT_CATEGORIES.filter((category) => category !== "news");

export const Route = createFileRoute("/_app/world")({
  head: () => ({ meta: [{ title: "World Monitor — MAET" }] }),
  component: WorldMonitor,
});

async function fetchWorld<T>(
  endpoint: "events" | "news" | "macro",
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(apiUrl(`/api/world/${endpoint}`), { signal });
  if (!response.ok) throw new Error(`World ${endpoint} unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

function useCategories() {
  const [selected, setSelected] = useState<ReadonlySet<EventCategory>>(
    () => new Set(EVENT_CATEGORIES),
  );
  return [
    selected,
    (category: EventCategory) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        return next;
      }),
  ] as const;
}

function WorldMonitor() {
  const natural = useQuery({
    queryKey: ["world", "events"],
    queryFn: ({ signal }) => fetchWorld<WorldEventsResponse>("events", signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  // The server answers news after its first GDELT query and keeps the rest queued, so a short
  // poll fills the feed on a cold start; reads are served from the 15-minute server cache.
  const news = useQuery({
    queryKey: ["world", "news"],
    queryFn: ({ signal }) => fetchWorld<WorldEventsResponse>("news", signal),
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });
  const macro = useQuery({
    queryKey: ["world", "macro"],
    queryFn: ({ signal }) => fetchWorld<WorldMacroResponse>("macro", signal),
    staleTime: 24 * 60 * 60_000,
  });
  const [layers, toggleLayer] = useCategories();
  const [categories, toggleCategory] = useCategories();
  const [selectedId, select] = useState<string | null>(null);
  const events = useMemo(
    () =>
      [...(natural.data?.events ?? []), ...(news.data?.events ?? [])].sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt),
      ),
    [natural.data, news.data],
  );
  const exposure = useMemo(() => matchExposure(events), [events]);
  const visibleEvents = events.filter((event) => categories.has(event.category));
  const sources = [...(natural.data?.sources ?? []), ...(news.data?.sources ?? [])];
  const loading = (natural.isPending || news.isPending) && events.length === 0;
  const retryEvents = () => {
    void natural.refetch();
    void news.refetch();
  };
  const warnings = (
    <>
      <QueryError error={natural.error} retry={() => void natural.refetch()} />
      <QueryError error={news.error} retry={() => void news.refetch()} />
      <SourceWarnings sources={sources} retry={retryEvents} />
    </>
  );
  const mapSkeleton = <div className="h-full animate-pulse bg-muted" aria-label="Loading map" />;

  return (
    <div className="space-y-2 p-2 md:p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-1 px-1 pb-1">
        <h1 className="text-base font-semibold">World Monitor</h1>
        <p className="text-[11px] text-muted-foreground">Global events · Indian market context</p>
      </header>
      <MarketStrip />
      <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <WorldPanel title="World map" sources={natural.data?.sources ?? []}>
          <CategoryToggles
            label="Map layers"
            selected={layers}
            onToggle={toggleLayer}
            categories={MAP_CATEGORIES}
          />
          <p className="border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
            M4.5+ earthquakes · past 24h / Open natural events · past 7 days
          </p>
          <QueryError error={natural.error} retry={() => void natural.refetch()} />
          <SourceWarnings
            sources={natural.data?.sources ?? []}
            retry={() => void natural.refetch()}
          />
          <div className="h-[260px] md:h-[420px]">
            <ClientOnly fallback={mapSkeleton}>
              <Suspense fallback={mapSkeleton}>
                <WorldMap events={events} visible={layers} selectedId={selectedId} />
              </Suspense>
            </ClientOnly>
          </div>
        </WorldPanel>
        <WorldPanel title="Event feed" sources={sources}>
          <div className="border-b border-border">
            <CategoryToggles
              label="Feed categories"
              selected={categories}
              onToggle={toggleCategory}
              categories={EVENT_CATEGORIES}
            />
          </div>
          {warnings}
          <div className="max-h-[420px] overflow-y-auto" aria-label="Events">
            {loading ? (
              <SkeletonRows count={6} />
            ) : visibleEvents.length ? (
              visibleEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedId}
                  onSelect={select}
                />
              ))
            ) : (
              <EmptyLine>No events in the selected categories.</EmptyLine>
            )}
          </div>
        </WorldPanel>
        <WorldPanel title="Market exposure" sources={sources} className="lg:col-span-2">
          <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
            Rule-based exposure hints, not predictions.
          </p>
          {warnings}
          {loading ? (
            <SkeletonRows />
          ) : exposure.length ? (
            <ExposureTable rows={exposure} onSelect={select} />
          ) : (
            <EmptyLine>No current events match an exposure rule.</EmptyLine>
          )}
        </WorldPanel>
        <WorldPanel
          title="Macro snapshot"
          sources={macro.data?.sources ?? []}
          className="lg:col-span-2"
        >
          <QueryError error={macro.error} retry={() => void macro.refetch()} />
          <SourceWarnings sources={macro.data?.sources ?? []} retry={() => void macro.refetch()} />
          {macro.isPending ? (
            <SkeletonRows count={6} />
          ) : macro.data?.points.length ? (
            <MacroTable points={macro.data.points} />
          ) : (
            <EmptyLine>No macro observations are available.</EmptyLine>
          )}
        </WorldPanel>
      </div>
    </div>
  );
}
