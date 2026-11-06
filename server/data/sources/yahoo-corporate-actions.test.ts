import { afterEach, describe, expect, it } from "bun:test";
import fixture from "./fixtures/yahoo-chart-events-reliance.json";
import {
  UpstreamDegradedError,
  _resetCircuitForTest,
  getCorporateActions,
  normalizeYahooCorporateActions,
  type YahooChartEvents,
} from "./yahoo";

// Trimmed real response: RELIANCE.NS, range=max, interval=1mo, events=div,splits
// (dividends since 2017 and every split Yahoo reports).
const result = fixture.chart.result[0];
const events = result.events as YahooChartEvents;

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  _resetCircuitForTest();
});

describe("normalizeYahooCorporateActions", () => {
  const normalized = normalizeYahooCorporateActions(events, result.meta);

  it("dates events by their IST ex-date and orders them newest first", () => {
    expect(normalized.map((event) => event.exDate).slice(0, 4)).toEqual([
      "2026-06-05",
      "2025-08-14",
      "2024-10-28",
      "2024-08-19",
    ]);
    const dates = normalized.map((event) => event.exDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(normalized).toHaveLength(14);
  });

  it("reads Yahoo's 2:1 for the October 2024 1:1 bonus as 2 new shares per 1 held", () => {
    expect(normalized.find((event) => event.exDate === "2024-10-28")).toEqual({
      kind: "split",
      exDate: "2024-10-28",
      numerator: 2,
      denominator: 1,
    });
    expect(normalized.filter((event) => event.kind === "split")).toHaveLength(4);
  });

  it("keeps the dividend amount and the response currency, flagging amounts restated for a later split", () => {
    expect(normalized.find((event) => event.exDate === "2025-08-14")).toEqual({
      kind: "dividend",
      exDate: "2025-08-14",
      amount: 5.5,
      currency: "INR",
      adjusted: false,
    });
    // ₹10 was paid before the 1:1 bonus; Yahoo restates it as ₹5.
    expect(normalized.find((event) => event.exDate === "2024-08-19")).toMatchObject({
      amount: 5,
      adjusted: true,
    });
  });

  it("flags amounts Yahoo restated for a rights issue, which it does not report as an event", () => {
    // BHARTIARTL as served on 7 Nov 2026: NSE lists ₹2 (6 Aug 2020) and ₹3 (1 Aug 2022);
    // Yahoo restates the 2020 dividend for the 2021 rights issue. A declared rate has at
    // most three decimals (37.5% of a ₹1 face value is ₹0.375).
    const parsed = normalizeYahooCorporateActions(
      {
        dividends: {
          a: { amount: 1.963142, date: Date.UTC(2020, 7, 6, 3, 45) / 1000 },
          b: { amount: 3, date: Date.UTC(2022, 7, 1, 3, 45) / 1000 },
          c: { amount: 0.375, date: Date.UTC(2023, 7, 1, 3, 45) / 1000 },
        },
      },
      { currency: "INR", gmtoffset: 19800 }
    );
    expect(parsed.map((event) => [event.exDate, event.kind === "dividend" && event.adjusted])).toEqual([
      ["2023-08-01", false],
      ["2022-08-01", false],
      ["2020-08-06", true],
    ]);
  });

  it("drops duplicate events that arrive under different keys", () => {
    const duplicated: YahooChartEvents = {
      dividends: { ...events.dividends, "1": { amount: 5.5, date: 1755143100 } },
      splits: { ...events.splits, "2": { date: 1730087100, numerator: 2, denominator: 1, splitRatio: "2:1" } },
    };
    expect(normalizeYahooCorporateActions(duplicated, result.meta)).toEqual(normalized);
  });

  it("parses splitRatio when the numeric fields are missing and ignores no-op or malformed splits", () => {
    const parsed = normalizeYahooCorporateActions(
      {
        splits: {
          // ITC's July 2016 1:2 bonus, as Yahoo reports it.
          a: { date: 1467344700, splitRatio: "3:2" },
          b: { date: 1467344700 + 86_400, splitRatio: "1:1" },
          c: { date: 1467344700 + 2 * 86_400, splitRatio: "bonus" },
        },
      },
      { currency: "INR", gmtoffset: 19800 }
    );
    expect(parsed).toEqual([{ kind: "split", exDate: "2016-07-01", numerator: 3, denominator: 2 }]);
  });

  it("never assumes a currency or a date", () => {
    const parsed = normalizeYahooCorporateActions({
      dividends: {
        a: { amount: 4, date: 1755143100 },
        b: { amount: 4, date: 1755143100 + 86_400, currency: "USD" },
        c: { amount: 4 },
        d: { amount: 0, date: 1755143100, currency: "INR" },
      },
    });
    expect(parsed).toEqual([
      { kind: "dividend", exDate: "2025-08-15", amount: 4, currency: "USD", adjusted: false },
    ]);
  });
});

describe("getCorporateActions", () => {
  it("asks Yahoo for the full history of dividends and splits", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      return Response.json(fixture);
    }) as unknown as typeof fetch;

    const actions = await getCorporateActions("RELIANCE");

    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe("/v8/finance/chart/RELIANCE.NS");
    expect(url.searchParams.get("range")).toBe("max");
    expect(url.searchParams.get("events")).toBe("div,splits");
    expect(actions).toEqual(normalizeYahooCorporateActions(events, result.meta));
  });

  it("reports throttling as a degraded upstream after retrying", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    await expect(getCorporateActions("RELIANCE")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(calls).toBe(3);
  });
});
