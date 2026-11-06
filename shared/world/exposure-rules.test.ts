import { describe, expect, it } from "bun:test";
import nifty50 from "../symbols/nifty50.json";
import type { WorldEvent } from "./contracts";
import { EXPOSURE_RULES, matchExposure } from "./exposure-rules";

function event(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: "event-1",
    title: "Cyclone over the Bay of Bengal",
    category: "storm",
    source: "NASA EONET",
    url: "https://example.org/event-1",
    occurredAt: "2026-11-01T00:00:00.000Z",
    coordinates: { longitude: 88, latitude: 15 },
    ...overrides,
  };
}

function ruleIds(input: WorldEvent): string[] {
  return matchExposure([input]).map((match) => match.ruleId);
}

describe("matchExposure", () => {
  it("returns the event and transparent rule metadata without mutating inputs", () => {
    const input = Object.freeze({
      ...event(),
      coordinates: Object.freeze({ longitude: 88, latitude: 15 }),
    });
    const events = Object.freeze([input]);
    const rule = EXPOSURE_RULES.find((candidate) => candidate.id === "bay-of-bengal-storm")!;
    const matches = matchExposure(events);

    expect(matches).toEqual([
      {
        event: input,
        ruleId: rule.id,
        region: "Bay of Bengal",
        sectors: rule.sectors,
        ruleText: rule.ruleText,
        watchSymbols: rule.watchSymbols,
      },
    ]);
    expect(matches[0]!.event).toBe(input);
    expect(matchExposure(events)).toEqual(matches);
  });

  it("includes every bounding-box edge and corner and excludes points just outside", () => {
    for (const rule of EXPOSURE_RULES) {
      for (const region of rule.regions) {
        if (!region.bbox) continue;
        const [west, south, east, north] = region.bbox;
        const middleLongitude = (west + east) / 2;
        const middleLatitude = (south + north) / 2;
        const base = event({
          category: rule.categories[0]!,
          title: rule.headlineKeywords?.[0] ?? "Regional event",
        });
        const inside = [
          [west, south],
          [west, north],
          [east, south],
          [east, north],
          [west, middleLatitude],
          [east, middleLatitude],
          [middleLongitude, south],
          [middleLongitude, north],
        ];
        for (const [longitude, latitude] of inside) {
          expect(
            ruleIds({ ...base, coordinates: { longitude: longitude!, latitude: latitude! } }),
          ).toContain(rule.id);
        }
        const outside = [
          [west - 0.0001, middleLatitude],
          [east + 0.0001, middleLatitude],
          [middleLongitude, south - 0.0001],
          [middleLongitude, north + 0.0001],
        ];
        for (const [longitude, latitude] of outside) {
          expect(
            ruleIds({ ...base, coordinates: { longitude: longitude!, latitude: latitude! } }),
          ).not.toContain(rule.id);
        }
      }
    }
  });

  it("matches explicit headline geography and topic case-insensitively, independently of publisher country", () => {
    for (const country of ["United Kingdom", "Taiwan", undefined]) {
      expect(
        ruleIds(
          event({
            category: "news",
            source: "GDELT",
            title: "TAIWAN SEMICONDUCTOR production update",
            country,
            coordinates: undefined,
          }),
        ),
      ).toEqual(["taiwan-semiconductor-news"]);
    }
  });

  it("accepts headline geography or coordinates, without duplicate matches", () => {
    const base = event({
      category: "news",
      source: "GDELT",
      title: "Saudi Arabia crude exports through oil terminal reviewed",
      country: "United Kingdom",
      coordinates: { longitude: 53, latitude: 27 },
    });
    expect(ruleIds(base)).toEqual(["gulf-oil-logistics-news"]);
    expect(ruleIds({ ...base, coordinates: undefined })).toEqual(["gulf-oil-logistics-news"]);
    expect(ruleIds({ ...base, title: "Crude exports through oil terminal reviewed" })).toEqual([
      "gulf-oil-logistics-news",
    ]);
  });

  it("does not treat publisher country as event geography", () => {
    for (const country of ["Saudi Arabia", "Taiwan", "India"]) {
      expect(
        ruleIds(
          event({
            category: "news",
            source: "GDELT",
            title: "Crude exports and semiconductor production reviewed",
            country,
            coordinates: undefined,
          }),
        ),
      ).toEqual([]);
    }
    expect(
      ruleIds(
        event({
          category: "news",
          source: "GDELT",
          title: "Norway crude exports reviewed",
          country: "Saudi Arabia",
          coordinates: undefined,
        }),
      ),
    ).toEqual([]);
  });

  it("requires geography, category and a relevant headline topic together", () => {
    const base = event({
      category: "news",
      source: "GDELT",
      title: "Red Sea shipping disruption raises freight costs",
      country: "United Kingdom",
      coordinates: undefined,
    });
    expect(ruleIds(base)).toEqual(["red-sea-shipping-news"]);
    expect(
      ruleIds({ ...base, title: "Atlantic shipping disruption raises freight costs" }),
    ).toEqual([]);
    expect(ruleIds({ ...base, category: "other" })).toEqual([]);
    expect(ruleIds({ ...base, title: "Red Sea local festival announced" })).toEqual([]);
    expect(ruleIds({ ...base, title: "Local festival", detail: base.title })).toEqual([]);
    expect(ruleIds({ ...base, title: "Red Sea championship results" })).toEqual([]);
    expect(ruleIds({ ...base, title: "Taiwan semiconductorship awards" })).toEqual([]);
    expect(ruleIds({ ...base, title: "Saudi steel output cuts announced" })).toEqual([]);
  });

  it("links explicit Gulf oil sanctions and OPEC headlines without assuming a price direction", () => {
    for (const title of [
      "Iran oil sanctions reviewed",
      "Saudi Arabia OPEC production decision announced",
      "Kuwait crude output cuts announced",
    ]) {
      expect(
        ruleIds(
          event({
            category: "news",
            source: "GDELT",
            title,
            country: "United Kingdom",
            coordinates: undefined,
          }),
        ),
      ).toEqual(["gulf-oil-logistics-news"]);
    }
  });

  it("links central-bank rate headlines to the named bank's market only", () => {
    const news = (title: string) =>
      event({ category: "news", source: "GDELT", title, country: "India", coordinates: undefined });
    expect(ruleIds(news("RBI keeps repo rate unchanged"))).toEqual(["rbi-policy-rate-news"]);
    expect(ruleIds(news("Reserve Bank of India monetary policy: what to expect"))).toEqual([
      "rbi-policy-rate-news",
    ]);
    expect(ruleIds(news("Fed signals another rate cut"))).toEqual(["us-fed-rate-news"]);
    expect(ruleIds(news("FOMC holds interest rates steady"))).toEqual(["us-fed-rate-news"]);
    expect(ruleIds(news("Bank of England rate decision due"))).toEqual([]);
    expect(ruleIds(news("RBI governor speaks at banking summit"))).toEqual([]);
    expect(ruleIds(news("Federal Reserve Bank publishes jobs survey"))).toEqual([]);
    expect(ruleIds(news("Fedex lifts rate card"))).toEqual([]);
  });

  it("links Russian crude trade restrictions to Indian refiners", () => {
    const news = (title: string) =>
      event({
        category: "news",
        source: "GDELT",
        title,
        country: "United States",
        coordinates: undefined,
      });
    expect(ruleIds(news("EU tightens Russian oil price cap"))).toEqual(["russia-crude-trade-news"]);
    expect(ruleIds(news("New sanctions hit Rosneft tankers"))).toEqual(["russia-crude-trade-news"]);
    expect(ruleIds(news("Russia wheat exports rise"))).toEqual([]);
    expect(ruleIds(news("Oil sanctions on Venezuela extended"))).toEqual([]);
  });

  it("does not imply exposure from unrelated geography or headlines", () => {
    expect(matchExposure([])).toEqual([]);
    expect(
      matchExposure([
        event({ coordinates: { longitude: -74, latitude: 40 } }),
        event({ category: "earthquake" }),
        event({ coordinates: undefined }),
        event({ category: "wildfire", country: "Saudi Arabia", coordinates: undefined }),
        event({
          category: "news",
          country: "Taiwan",
          title: "Local election results",
          coordinates: undefined,
        }),
        event({
          category: "news",
          country: "France",
          title: "Semiconductor production update",
          coordinates: undefined,
        }),
        event({ category: "flood", country: "India", coordinates: undefined }),
        event({ coordinates: { longitude: Number.NaN, latitude: 15 } }),
      ]),
    ).toEqual([]);
  });

  it("preserves input order and emits one match for each applicable rule", () => {
    const first = event({ id: "first" });
    const second = event({ id: "second", coordinates: { longitude: 65, latitude: 15 } });
    expect(matchExposure([first, second]).map((match) => [match.event.id, match.ruleId])).toEqual([
      ["first", "bay-of-bengal-storm"],
      ["second", "arabian-sea-storm"],
    ]);
  });
});

describe("EXPOSURE_RULES", () => {
  it("uses unique rule IDs and only shipped active NSE watch symbols", () => {
    const symbols = new Set(
      nifty50
        .filter((entry) => entry.exchange === "NSE" && entry.isActive)
        .map((entry) => entry.symbol),
    );
    expect(EXPOSURE_RULES.length).toBeGreaterThan(0);
    expect(new Set(EXPOSURE_RULES.map((rule) => rule.id)).size).toBe(EXPOSURE_RULES.length);
    for (const rule of EXPOSURE_RULES) {
      expect(rule.categories.length).toBeGreaterThan(0);
      expect(rule.regions.length).toBeGreaterThan(0);
      expect(rule.sectors.length).toBeGreaterThan(0);
      expect(rule.ruleText.length).toBeGreaterThan(0);
      expect(rule.watchSymbols.length).toBeGreaterThan(0);
      expect(new Set(rule.watchSymbols).size).toBe(rule.watchSymbols.length);
      for (const symbol of rule.watchSymbols) expect(symbols.has(symbol)).toBe(true);
      if (rule.headlineKeywords) {
        expect(rule.headlineKeywords.length).toBeGreaterThan(0);
        for (const keyword of rule.headlineKeywords) {
          expect(keyword.trim().length).toBeGreaterThan(0);
          expect(keyword).toBe(keyword.toLowerCase());
        }
      }
      for (const region of rule.regions) {
        expect(
          region.bbox !== undefined ||
            (region.countries?.length ?? 0) > 0 ||
            (region.geographicHeadlineKeywords?.length ?? 0) > 0,
        ).toBe(true);
        if (region.bbox) {
          const [west, south, east, north] = region.bbox;
          expect(west).toBeLessThan(east);
          expect(south).toBeLessThan(north);
          expect(west).toBeGreaterThanOrEqual(-180);
          expect(east).toBeLessThanOrEqual(180);
          expect(south).toBeGreaterThanOrEqual(-90);
          expect(north).toBeLessThanOrEqual(90);
        }
        for (const country of region.countries ?? []) {
          expect(country.trim().length).toBeGreaterThan(0);
          expect(country).toBe(country.trim().toUpperCase());
        }
        for (const keyword of region.geographicHeadlineKeywords ?? []) {
          expect(keyword.trim().length).toBeGreaterThan(0);
          expect(keyword).toBe(keyword.trim().toLowerCase());
        }
      }
    }
  });
});
