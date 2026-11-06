import type { Page } from "@playwright/test";
import { COMPANIES, FIELD_AVAILABILITY, FIXED_NOW, quoteFor } from "./support/data";
import { test, expect } from "./support/fixtures";
import { API_ORIGIN, type MockApi } from "./support/mock-api";

const nameOf = (symbol: string) =>
  COMPANIES.find((company) => company.symbol === symbol)?.name ?? symbol;

/** The company cells, top to bottom, must be exactly these symbols. */
async function expectRows(page: Page, symbols: string[]) {
  await expect(page.locator("tbody tr td:nth-child(2) > button")).toHaveText(
    symbols.map((symbol) => new RegExp(`${symbol}${nameOf(symbol)}`)),
  );
}

function lastCompaniesQuery(api: MockApi): Record<string, string> {
  const request = api.requests
    .filter((entry) => entry.url.pathname === "/api/market/companies")
    .at(-1);
  return request ? Object.fromEntries(request.url.searchParams) : {};
}

const ALPHABETICAL = ["HDFCBANK", "INFY", "KPITTECH", "RELIANCE", "TATAELXSI", "TCS"];
// Fixture day changes: KPITTECH +2.4, RELIANCE +2.08, INFY +1.12, TCS +0.35, HDFCBANK -0.42, TATAELXSI -1.05.
const BY_CHANGE_DESC = ["KPITTECH", "RELIANCE", "INFY", "TCS", "HDFCBANK", "TATAELXSI"];

const apiPath = (pathname: string) => (url: URL) => url.origin === API_ORIGIN && url.pathname === pathname;

/**
 * Live quotes carrying each fixture company's own day change. The shared fixture quotes are
 * all +2.04%, which cannot show an ordering by change.
 */
async function serveDistinctQuotes(page: Page) {
  const payload = (symbols: string[]) => ({
    asOf: FIXED_NOW,
    source: "angelone",
    delayed: false,
    marketPhase: "OPEN",
    quotes: COMPANIES.filter((company) => symbols.includes(company.symbol)).map((company) => ({
      ...quoteFor(company.symbol, "open", company.price),
      changePct: company.changePct,
    })),
    errors: [],
  });
  await page.route(apiPath("/api/market/quotes"), (route) => {
    const symbols = new URL(route.request().url()).searchParams.get("symbols")?.split(",") ?? [];
    return route.fulfill({ json: payload(symbols) });
  });
  await page.route(apiPath("/api/market/stream"), (route) => {
    const symbols = new URL(route.request().url()).searchParams.getAll("symbols");
    return route.fulfill({
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body: `retry: 60000\n\nevent: snapshot\ndata: ${JSON.stringify(payload(symbols))}\n\n`,
    });
  });
}

/** GET /api/market/companies as server/domain/screener/company-query.ts answers it with PostgreSQL down. */
async function serveNseFallback(page: Page) {
  await page.route(apiPath("/api/market/companies"), (route) => {
    const items = COMPANIES.map(({ symbol, name, exchange, series, isin }) => ({
      symbol,
      name,
      exchange,
      series,
      isin,
      marketCapBucket: "unknown",
      yahooSymbol: `${symbol}.NS`,
      source: "nse",
    }));
    const unavailable = (reason: string) => ({ available: false, reason });
    return route.fulfill({
      json: {
        asOf: FIXED_NOW,
        generatedAt: FIXED_NOW,
        source: "nse-fallback",
        sourceSummary: ["NSE official company master", "Database unavailable: enriched filters are disabled"],
        total: items.length,
        universeTotal: items.length,
        page: 1,
        pageSize: 50,
        pageCount: 1,
        items,
        fieldAvailability: {
          identity: FIELD_AVAILABILITY.identity,
          isin: FIELD_AVAILABILITY.isin,
          marketCap: unavailable("Market cap is unavailable until a verified fundamentals source is ingested"),
          sector: unavailable("Sector unavailable from the verified company snapshot"),
          rsi: unavailable("RSI(14) unavailable"),
        },
        capBucketMethodology: "e2e fixture",
      },
    });
  });
}

test("screener: Gainers sorts by change % descending and Losers ascending", async ({ page, api }) => {
  await serveDistinctQuotes(page);
  await page.goto("/screener");
  await expectRows(page, ALPHABETICAL);

  await page.getByRole("button", { name: "Gainers" }).click();
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toEqual({ page: "1", limit: "50", sortBy: "change_pct", sortDir: "desc", change_pct_min: "0.01" });
  // The fixture API does not evaluate change filters, so all six rows return; the order is under test.
  await expectRows(page, BY_CHANGE_DESC);
  await expect(page.getByRole("button", { name: "Gainers" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Losers" }).click();
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toEqual({ page: "1", limit: "50", sortBy: "change_pct", sortDir: "asc", change_pct_max: "-0.01" });
  await expectRows(page, [...BY_CHANGE_DESC].reverse());

  // Back to the default symbol order; that page is still cached, so no new request is needed.
  await page.getByRole("button", { name: "All stocks" }).click();
  await expectRows(page, ALPHABETICAL);
});

test("screener: with the database offline, presets sort the live page by change % and empty columns are hidden", async ({
  page,
  api,
}) => {
  await serveDistinctQuotes(page);
  await serveNseFallback(page);
  await page.goto("/screener");
  await expectRows(page, ALPHABETICAL);
  await expect(page.getByText(/^Database offline:/)).toBeVisible();
  for (const empty of ["Market cap", "Sector"]) {
    await expect(page.getByRole("columnheader", { name: empty })).toHaveCount(0);
  }
  await expect(page.getByRole("columnheader", { name: "Chg %" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Valuation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "RSI Oversold" })).toBeDisabled();

  await page.getByRole("button", { name: "Gainers" }).click();
  // Change filters cannot be evaluated by the NSE fallback, so the page applies them to its live quotes.
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toEqual({ page: "1", limit: "50", sortBy: "change_pct", sortDir: "desc" });
  await expectRows(page, ["KPITTECH", "RELIANCE", "INFY", "TCS"]);
  await expect(page.getByText("4 of 6 on this page")).toBeVisible();

  await page.getByRole("button", { name: "Losers" }).click();
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toEqual({ page: "1", limit: "50", sortBy: "change_pct", sortDir: "asc" });
  await expectRows(page, ["TATAELXSI", "HDFCBANK"]);
});

test("screener: each row has one primary action and a keyboard-operable overflow menu", async ({ page, api }) => {
  await page.goto("/screener");
  await expectRows(page, ALPHABETICAL);
  const infy = page.locator("tbody tr").filter({ hasText: nameOf("INFY") });
  await expect(infy.getByRole("button")).toHaveText([/INFY/, "Terminal", ""]);

  await infy.getByRole("button", { name: "More actions for INFY" }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Full chart", "Company page", "TradingView", "Copy symbol"]);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Company page" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stock\/INFY$/);
  await expect(page.getByRole("heading", { level: 1, name: nameOf("INFY") })).toBeVisible();
  expect(
    api.requests.some(
      (entry) => entry.url.pathname === "/api/market/company" && entry.url.searchParams.get("symbol") === "INFY",
    ),
  ).toBe(true);
});

test("screener: sorting and filtering re-query the API and reorder the rows; a row opens its stock page", async ({
  page,
  api,
}) => {
  await page.goto("/screener");
  await expect(page.getByRole("heading", { level: 1, name: "Stock Screener" })).toBeVisible();

  await expectRows(page, ["HDFCBANK", "INFY", "KPITTECH", "RELIANCE", "TATAELXSI", "TCS"]);
  expect(lastCompaniesQuery(api)).toEqual({
    page: "1",
    limit: "50",
    sortBy: "symbol",
    sortDir: "asc",
  });

  const marketCapHeader = page
    .getByRole("columnheader")
    .getByRole("button", { name: "Market cap", exact: true });
  await marketCapHeader.click();
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toMatchObject({ sortBy: "market_cap", sortDir: "asc" });
  await expectRows(page, ["KPITTECH", "TATAELXSI", "INFY", "HDFCBANK", "TCS", "RELIANCE"]);

  await marketCapHeader.click();
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toMatchObject({ sortBy: "market_cap", sortDir: "desc" });
  await expectRows(page, ["RELIANCE", "TCS", "HDFCBANK", "INFY", "TATAELXSI", "KPITTECH"]);

  await page.getByRole("button", { name: "Advanced filters" }).click();
  await page.getByLabel("Sector", { exact: true }).fill("Technology");
  await expect
    .poll(() => lastCompaniesQuery(api))
    .toEqual({
      page: "1",
      limit: "50",
      sortBy: "market_cap",
      sortDir: "desc",
      sector_in: "Technology",
    });
  await expectRows(page, ["TCS", "INFY", "TATAELXSI", "KPITTECH"]);
  await expect(page.getByText(/^4 results$/)).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`INFY\\s*${nameOf("INFY")}`) }).click();
  await expect(page).toHaveURL(/\/stock\/INFY$/);
  await expect(page.getByRole("heading", { level: 1, name: nameOf("INFY") })).toBeVisible();
  await expect(page.getByText("ISIN INE009A01021")).toBeVisible();
  expect(
    api.requests.some(
      (entry) =>
        entry.url.pathname === "/api/market/company" &&
        entry.url.searchParams.get("symbol") === "INFY",
    ),
  ).toBe(true);
});
