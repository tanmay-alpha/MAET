import { describe, expect, it } from "bun:test";
import usgs from "./__fixtures__/usgs.json";
import eonet from "./__fixtures__/eonet.json";
import gdelt from "./__fixtures__/gdelt.json";
import gdp from "./__fixtures__/world-bank-gdp.json";
import cpi from "./__fixtures__/world-bank-cpi.json";
import { normalizeEonet, normalizeGdelt } from "../../../shared/world/normalize";
import { normalizeUsgs, normalizeWorldBank } from "./adapters";

const recordedNow = Date.parse("2026-11-07T00:00:00Z");

describe("world adapters with trimmed upstream recordings", () => {
  it("normalizes the USGS M4.5 day feed without swapping coordinate axes", () => {
    expect(normalizeUsgs(usgs)).toEqual([
      {
        id: "usgs:us7000twhq",
        title: "M 4.5 - 101 km SSE of Palekastro, Greece",
        category: "earthquake",
        source: "USGS",
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000twhq",
        occurredAt: new Date(1793978818080).toISOString(),
        coordinates: { longitude: 26.4987, latitude: 34.3043 },
        magnitude: 4.5,
        detail: "101 km SSE of Palekastro, Greece",
      },
    ]);
    const weak = structuredClone(usgs);
    weak.features[0]!.properties.mag = 4.4;
    expect(normalizeUsgs(weak)).toEqual([]);
    const broken = structuredClone(usgs);
    broken.features[0]!.geometry.coordinates = [181, 92];
    expect(() => normalizeUsgs(broken)).toThrow("no usable records");
  });

  it("normalizes open EONET events using latest geometry and explicit magnitude units", () => {
    const input = structuredClone(eonet);
    input.events[0]!.geometry.unshift({
      ...input.events[0]!.geometry[0]!,
      date: "2026-11-01T00:00:00Z",
      coordinates: [12, 13],
    });
    const event = normalizeEonet(input, recordedNow)[0]!;
    expect(event.category).toBe("wildfire");
    expect(event.coordinates).toEqual({ longitude: -71.031283, latitude: 44.330583 });
    expect(event.occurredAt).toBe("2026-11-02T07:58:00.000Z");
    expect(event.detail).toContain("982 acres");
    expect(normalizeEonet(eonet, recordedNow + 7 * 86_400_000)).toEqual([]);
    expect(
      normalizeEonet(
        { events: [{ ...eonet.events[0], closed: "2026-11-03T00:00:00Z" }] },
        recordedNow,
      ),
    ).toEqual([]);
    expect(() =>
      normalizeEonet(
        { events: [{ ...eonet.events[0], geometry: [{ date: "2026-11-02T00:00:00Z" }] }] },
        recordedNow,
      ),
    ).toThrow("no usable records");
    expect(() =>
      normalizeEonet({ events: [{ ...eonet.events[0], closed: undefined }] }, recordedNow),
    ).toThrow();
  });

  it("does not invent polygon centroids or news locations", () => {
    const polygon = {
      ...eonet.events[0],
      geometry: [
        {
          date: "2026-11-02T00:00:00Z",
          type: "Polygon",
          coordinates: [
            [
              [10, 20],
              [11, 20],
              [10, 21],
              [10, 20],
            ],
          ],
        },
      ],
    };
    expect(normalizeEonet({ events: [polygon] }, recordedNow)[0]).not.toHaveProperty("coordinates");
    const article = normalizeGdelt(gdelt)[0]!;
    expect(article.occurredAt).toBe("2026-11-06T04:00:00.000Z");
    expect(article.domain).toBe("www.zerohedge.com");
    expect(article.country).toBe("United States");
    expect(article).not.toHaveProperty("coordinates");
  });

  it("rejects unusable article schemas, non-English content, unsafe URLs and impossible dates", () => {
    for (const patch of [
      { title: "" },
      { url: "javascript:alert(1)" },
      { language: "French" },
      { seendate: "20260230T040000Z" },
    ]) {
      expect(() => normalizeGdelt({ articles: [{ ...gdelt.articles[0], ...patch }] })).toThrow(
        "no usable records",
      );
    }
    expect(normalizeGdelt({ articles: [{}, ...gdelt.articles] })).toHaveLength(1);
  });

  it("chooses latest nonnull macro observations and emits ISO3 including EMU", () => {
    const points = normalizeWorldBank(gdp, "gdpGrowth");
    expect(points.map((point) => point.countryCode)).toEqual([
      "IND",
      "USA",
      "CHN",
      "EMU",
      "JPN",
      "GBR",
    ]);
    expect(points.find((point) => point.countryCode === "EMU")).toMatchObject({
      country: "Euro area",
      value: 1.4110724231835,
      year: 2025,
    });
    const input = structuredClone(gdp) as unknown as [
      Record<string, unknown>,
      Record<string, unknown>[],
    ];
    const india = input[1].find((row) => row.countryiso3code === "IND")!;
    input[1].push({ ...india, date: "2026", value: null }, { ...india, date: "2023", value: 0 });
    expect(
      normalizeWorldBank(input, "gdpGrowth").find((point) => point.countryCode === "IND")?.year,
    ).toBe(2025);
    expect(normalizeWorldBank(cpi, "cpi").find((point) => point.countryCode === "USA")?.year).toBe(
      2024,
    );
    expect(() => normalizeWorldBank(gdp, "cpi")).toThrow("missing country");
    expect(() => normalizeWorldBank([{ pages: 2 }, input[1]], "gdpGrowth")).toThrow(
      "Invalid World Bank",
    );
    expect(() =>
      normalizeWorldBank(
        [{ pages: 1 }, input[1].filter((row) => row.countryiso3code !== "EMU")],
        "gdpGrowth",
      ),
    ).toThrow("missing country");
  });

  it("distinguishes validated empty feeds from upstream error documents", () => {
    expect(normalizeUsgs({ type: "FeatureCollection", features: [] })).toEqual([]);
    expect(normalizeEonet({ events: [] }, recordedNow)).toEqual([]);
    expect(normalizeGdelt({ articles: [] })).toEqual([]);
    // GDELT answers a query with no matching articles with a bare `{}`.
    expect(normalizeGdelt({})).toEqual([]);
    expect(() => normalizeUsgs({ error: "unavailable" })).toThrow();
    expect(() => normalizeEonet({ message: "unavailable" }, recordedNow)).toThrow();
    expect(() => normalizeGdelt({ error: "rate limit" })).toThrow();
    expect(() => normalizeWorldBank([{ message: [{ id: "120" }] }], "cpi")).toThrow();
  });
});
