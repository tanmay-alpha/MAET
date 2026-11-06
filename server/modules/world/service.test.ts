import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "bun:test";
import usgs from "./__fixtures__/usgs.json";
import eonet from "./__fixtures__/eonet.json";
import gdelt from "./__fixtures__/gdelt.json";
import gdp from "./__fixtures__/world-bank-gdp.json";
import cpi from "./__fixtures__/world-bank-cpi.json";
import { createWorldService, GDELT_INTERVAL_MS, GDELT_QUERIES, GDELT_SPACING_MS } from "./service";

const epoch = Date.parse("2026-11-07T00:00:00Z");

/** The injected sleep and fetch settle in microtasks, so one macrotask turn lets every queued GDELT query finish. */
const drainQueue = () => setImmediate();

describe("world service lazy adapters", () => {
  it("only loads requested endpoints, coalesces readers and caches independent event sources", async () => {
    let now = epoch;
    const urls: string[] = [];
    const gate = Promise.withResolvers<void>();
    const service = createWorldService({
      now: () => now,
      fetch: async (url) => {
        urls.push(url);
        await gate.promise;
        return Response.json(url.includes("usgs") ? usgs : eonet);
      },
    });
    expect(urls).toEqual([]);
    const first = service.events();
    const second = service.events();
    expect(urls).toHaveLength(2);
    gate.resolve();
    expect(await first).toEqual(await second);
    const initial = await service.events();
    expect(initial.events).toHaveLength(2);
    expect(initial.sources.map((source) => source.source)).toEqual(["USGS", "NASA EONET"]);
    expect(initial.sources.every((source) => !source.stale)).toBe(true);
    now += 60_000;
    await service.events();
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain("4.5_day.geojson");
    expect(urls[1]).toContain("status=open&days=7");
    expect(urls.some((url) => url.includes("gdelt") || url.includes("worldbank"))).toBe(false);
  });

  it("retains last-good data for a malformed refresh while unaffected sources stay fresh", async () => {
    let now = epoch;
    let broken = false;
    let calls = 0;
    const service = createWorldService({
      now: () => now,
      fetch: async (url) => {
        calls++;
        return Response.json(url.includes("usgs") ? (broken ? { features: [{}] } : usgs) : eonet);
      },
    });
    const first = await service.events();
    broken = true;
    now += 60_000;
    const stale = await service.events();
    expect(stale.events).toEqual(first.events);
    expect(stale.sources[0]).toMatchObject({ stale: true, fetchedAt: first.sources[0]!.fetchedAt });
    expect(stale.sources[0]!.error).toContain("Invalid USGS");
    expect(stale.sources[1]!.stale).toBe(false);
    now += 59_999;
    await service.events();
    expect(calls).toBe(3);
    broken = false;
    now++;
    expect((await service.events()).sources[0]!.stale).toBe(false);
  });

  it("limits every GDELT query including failures to one attempt per fifteen minutes", async () => {
    let now = epoch;
    let failing = true;
    let active = 0;
    let maxActive = 0;
    const calls: { query: string; at: number }[] = [];
    const service = createWorldService({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: async (url) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const params = new URL(url).searchParams;
        calls.push({ query: params.get("query")!, at: now });
        expect(params.get("mode")).toBe("artlist");
        expect(params.get("format")).toBe("json");
        await Promise.resolve();
        active--;
        return failing ? new Response("unavailable", { status: 429 }) : Response.json(gdelt);
      },
    });
    expect(calls).toHaveLength(0);
    const [first, same] = await Promise.all([service.news(), service.news()]);
    expect(first).toEqual(same);
    expect(first.events).toEqual([]);
    expect(first.sources[0]).toMatchObject({
      source: "GDELT",
      fetchedAt: null,
      stale: true,
      error: "Upstream HTTP 429",
    });
    // The response does not wait for the whole spaced queue; the remaining queries keep running.
    expect(calls.length).toBeLessThan(GDELT_QUERIES.length);
    await drainQueue();
    expect(calls.map((call) => call.query)).toEqual([...GDELT_QUERIES]);
    expect(maxActive).toBe(1);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(GDELT_SPACING_MS);
    for (let i = 0; i < 3; i++) await service.news();
    expect(calls).toHaveLength(GDELT_QUERIES.length);
    now += GDELT_INTERVAL_MS;
    failing = false;
    await service.news();
    await drainQueue();
    const recovered = await service.news();
    expect(calls).toHaveLength(GDELT_QUERIES.length * 2);
    for (let i = 0; i < GDELT_QUERIES.length; i++)
      expect(calls[i + GDELT_QUERIES.length]!.at - calls[i]!.at).toBeGreaterThanOrEqual(
        GDELT_INTERVAL_MS,
      );
    expect(recovered.events).toHaveLength(1);
    expect(recovered.events[0]).not.toHaveProperty("coordinates");
    expect(recovered.sources[0]!.stale).toBe(false);
    now += GDELT_INTERVAL_MS;
    failing = true;
    await service.news();
    await drainQueue();
    const stale = await service.news();
    expect(stale.events).toEqual(recovered.events);
    expect(stale.sources[0]).toMatchObject({
      fetchedAt: recovered.sources[0]!.fetchedAt,
      stale: true,
    });
  });

  it("fetches correct macro series and Euro area code, retaining points across independent failures", async () => {
    let now = epoch;
    let failing = false;
    const urls: string[] = [];
    const service = createWorldService({
      now: () => now,
      fetch: async (url) => {
        urls.push(url);
        if (url.includes("FP.CPI") && failing) return Response.json({ error: "bad schema" });
        return Response.json(url.includes("FP.CPI") ? cpi : gdp);
      },
    });
    const first = await service.macro();
    expect(first.points).toHaveLength(12);
    expect(first.points.filter((point) => point.countryCode === "EMU")).toHaveLength(2);
    expect(urls.every((url) => url.includes("IN;US;CN;EMU;JP;GB") && url.includes("mrnev=1"))).toBe(
      true,
    );
    now += 24 * 60 * 60_000;
    failing = true;
    const stale = await service.macro();
    expect(stale.points).toEqual(first.points);
    expect(stale.sources[0]).toMatchObject({ stale: true, fetchedAt: first.sources[0]!.fetchedAt });
    expect(stale.sources[0]!.error).toContain("Invalid World Bank");
    now += 5 * 60_000 - 1;
    await service.macro();
    expect(urls).toHaveLength(4);
    now++;
    failing = false;
    expect((await service.macro()).sources[0]!.stale).toBe(false);
    expect(urls).toHaveLength(5);
  });
  it("preserves available component timestamps during cold partial failures", async () => {
    let now = epoch;
    const service = createWorldService({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: async (url) => {
        if (url.includes("worldbank"))
          return url.includes("FP.CPI") ? new Response("", { status: 503 }) : Response.json(gdp);
        const query = new URL(url).searchParams.get("query");
        return query === GDELT_QUERIES[0]
          ? Response.json(gdelt)
          : new Response("", { status: 503 });
      },
    });
    const macro = await service.macro();
    expect(macro.points).toHaveLength(6);
    expect(macro.sources[0]).toMatchObject({
      fetchedAt: new Date(epoch).toISOString(),
      stale: true,
      error: "Upstream HTTP 503",
    });
    const partial = await service.news();
    expect(partial.events).toHaveLength(1);
    // Queries still queued are not reported as failures before they have been attempted.
    expect(partial.sources[0]).toEqual({
      source: "GDELT",
      fetchedAt: new Date(epoch).toISOString(),
      stale: false,
    });
    await drainQueue();
    const news = await service.news();
    expect(news.events).toHaveLength(1);
    expect(news.sources[0]).toMatchObject({
      fetchedAt: new Date(epoch).toISOString(),
      stale: true,
      error: "Upstream HTTP 503",
    });
  });
});
