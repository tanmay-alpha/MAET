import type { Page, Route } from "@playwright/test";
import { BASE_PRICES, FIXED_NOW, quoteFor } from "./support/data";
import { test, expect } from "./support/fixtures";
import { API_ORIGIN, type MockApi } from "./support/mock-api";

const price = (value: number) => value.toLocaleString("en-IN");
const NIFTY50_COUNT = 50;
const INDEX_COUNT = 6;

/** The fixture quotes carry FIXED_NOW timestamps; "live" needs them to be from today's IST session. */
async function atFixtureTime(page: Page) {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
}

/**
 * Answers GET /api/market/quotes with `respond` (or never, when it is null) and keeps the
 * market stream silent, so the REST response is the only quote data the page receives.
 */
async function overrideQuotes(page: Page, respond: ((symbols: string[]) => unknown) | null) {
  const isApi = (url: URL, path: string) => url.origin === API_ORIGIN && url.pathname === path;
  await page.route((url) => isApi(url, "/api/market/stream"), (route: Route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" }, body: "retry: 600000\n\n" }),
  );
  await page.route((url) => isApi(url, "/api/market/quotes"), async (route: Route) => {
    if (!respond) return; // Never answered: the page has had no response yet.
    const symbols = (new URL(route.request().url()).searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(respond(symbols)) });
  });
}

function openPayload(symbols: string[], quoted: string[]) {
  return {
    asOf: FIXED_NOW,
    source: "angelone",
    delayed: false,
    marketPhase: "OPEN",
    quotes: quoted.map((symbol) => quoteFor(symbol, "open")),
    errors: symbols.filter((symbol) => !quoted.includes(symbol)).map((symbol) => ({ symbol, message: "quote timed out" })),
  };
}

async function quoteRequested(api: MockApi) {
  await expect.poll(() => api.requests.some((entry) => entry.url.pathname === "/api/market/quotes")).toBe(true);
}

async function expectNotLive(page: Page) {
  await expect(page.getByText(/\blive\b/i)).toHaveCount(0);
}

test("no response yet: quotes are loading, never live", async ({ page, api }) => {
  await atFixtureTime(page);
  await overrideQuotes(page, null);
  await page.goto("/dashboard");
  await quoteRequested(api);

  await expect(page.getByText("Loading quotes", { exact: true })).toBeVisible();
  // App-shell ticker badge.
  await expect(page.getByText("Loading", { exact: true })).toBeVisible();
  await expectNotLive(page);
});

test("empty response: no quotes, never live", async ({ page, api }) => {
  await atFixtureTime(page);
  await overrideQuotes(page, (symbols) => openPayload(symbols, []));
  await page.goto("/dashboard");
  await quoteRequested(api);

  await expect(page.getByText("No quotes", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Market open", { exact: true })).toBeVisible();
  await expectNotLive(page);
});

test("partial response: the label says how many symbols were quoted", async ({ page, api }) => {
  await atFixtureTime(page);
  await overrideQuotes(page, (symbols) => openPayload(symbols, symbols.slice(0, Math.ceil(symbols.length / 2))));
  await page.goto("/dashboard");
  await quoteRequested(api);

  await expect(page.getByText(`Live quotes · ${NIFTY50_COUNT / 2} of ${NIFTY50_COUNT} symbols quoted`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Live ${INDEX_COUNT / 2}/${INDEX_COUNT}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Live quotes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
});

test("after hours: closed-market quotes are labelled as the last available, never live", async ({ page, api }) => {
  api.session = "closed";
  await page.goto("/dashboard");

  // The REST snapshot landed, then the SSE tick replaced NIFTY 50's price.
  await expect(page.getByText(price(api.tick.price), { exact: true }).first()).toBeVisible();
  expect(api.requests.some((entry) => entry.url.pathname === "/api/market/stream")).toBe(true);

  await expect(page.getByText("Market closed · last available quotes", { exact: true })).toBeVisible();
  // App-shell ticker badge.
  await expect(page.getByText("Market closed", { exact: true })).toBeVisible();
  await expectNotLive(page);
});

test("market hours: today's broker quotes are labelled live", async ({ page, api }) => {
  await atFixtureTime(page);
  api.session = "open";
  await page.goto("/dashboard");

  await expect(page.getByText(price(api.tick.price), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(price(BASE_PRICES.SENSEX), { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Live quotes", { exact: true })).toBeVisible();
  await expect(page.getByText("Market open", { exact: true })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toHaveCount(0);
});

test("market hours: yesterday's broker quotes are not live today", async ({ page, api }) => {
  // One day after the fixture prints, with the server still reporting an open session.
  await page.clock.setFixedTime(new Date(Date.parse(FIXED_NOW) + 86_400_000));
  api.session = "open";
  await page.goto("/dashboard");

  await expect(page.getByText(price(BASE_PRICES.SENSEX), { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Delayed quotes", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toBeVisible();
  await expectNotLive(page);
});
