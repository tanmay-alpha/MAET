import type { Page } from "@playwright/test";
import type { MarketCompany } from "../../src/lib/market-api";
import { COMPANIES, FIXED_NOW, quoteFor } from "./support/data";
import { expect, signIn, test } from "./support/fixtures";
import { API_ORIGIN, type MockApi } from "./support/mock-api";

const nameOf = (symbol: string) => COMPANIES.find((company) => company.symbol === symbol)?.name ?? symbol;

function lastCompaniesQuery(api: MockApi): Record<string, string> {
  const request = api.requests.filter((entry) => entry.url.pathname === "/api/market/companies").at(-1);
  return request ? Object.fromEntries(request.url.searchParams) : {};
}

/** The fixture companies with the given fields replaced; `null` is what the API sends for a missing metric. */
function withNulls(overrides: Record<string, Record<string, unknown>>): MarketCompany[] {
  return COMPANIES.map((company) => ({ ...company, ...overrides[company.symbol] }) as MarketCompany);
}

const STALE_QUOTE_TS = "2026-10-30T10:00:00.000Z";

/**
 * Quotes from two providers: Angel One live for most rows, a week-old delayed Yahoo quote with
 * no volume for KPITTECH, and none at all for TATAELXSI.
 */
async function serveMixedQuotes(page: Page) {
  const quote = (symbol: string) => {
    const company = COMPANIES.find((row) => row.symbol === symbol);
    // Index quotes (e.g. the header ticker) keep their fixture values.
    if (!company) return quoteFor(symbol, "open");
    const live = { ...quoteFor(symbol, "open", company.price), changePct: company.changePct };
    if (symbol !== "KPITTECH") return live;
    const { volume: _volume, ...withoutVolume } = live;
    return { ...withoutVolume, source: "yahoo", quality: "delayed", delayed: true, ts: STALE_QUOTE_TS };
  };
  const payload = (symbols: string[]) => ({
    asOf: FIXED_NOW,
    source: "angelone",
    delayed: false,
    marketPhase: "OPEN",
    quotes: symbols.filter((symbol) => symbol !== "TATAELXSI").map(quote),
    errors: symbols.includes("TATAELXSI") ? [{ symbol: "TATAELXSI", message: "No quote from any provider" }] : [],
  });
  const apiPath = (pathname: string) => (url: URL) => url.origin === API_ORIGIN && url.pathname === pathname;
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

/** The cell under `header` in the row of `symbol`, by DOM position (hidden columns still count). */
async function cell(page: Page, symbol: string, header: string) {
  const headers = (await page.locator("thead th").allTextContents()).map((text) => text.trim());
  const index = headers.indexOf(header);
  expect(index, `column "${header}" in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);
  return page.locator("tbody tr").filter({ hasText: nameOf(symbol) }).locator("td").nth(index);
}

async function expectMissing(page: Page, symbol: string, header: string) {
  const target = await cell(page, symbol, header);
  await expect(target).toHaveText("—Not available");
  await expect(target.getByText("Not available")).toHaveClass(/sr-only/);
}

const VIEWPORTS = [
  { width: 1440, height: 900, mobile: false },
  { width: 360, height: 780, mobile: true },
];

for (const { width, height, mobile } of VIEWPORTS) {
  test.describe(`screener data honesty at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    // The desktop project covers 1440px, the touch (mobile) project 360px.
    test.skip(({ isMobile }) => isMobile !== mobile, `${width}px runs in the ${mobile ? "mobile" : "desktop"} project`);

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(FIXED_NOW));
    });

    test("numeric columns state their unit and use Indian grouping; missing metrics read as not available", async ({ page, api }) => {
      api.screenerRows = withNulls({ KPITTECH: { marketCap: null, volume: null }, INFY: { pe: null }, TATAELXSI: { price: null } });
      await serveMixedQuotes(page);
      await page.goto("/screener");

      for (const header of ["Price (₹)", "Chg (%)", "Volume (shares)", "Market cap (₹ Cr)"]) {
        await expect(page.getByRole("columnheader", { name: header })).toBeAttached();
      }
      await expect(await cell(page, "HDFCBANK", "Price (₹)")).toHaveText("1,650.40");
      await expect(await cell(page, "HDFCBANK", "Chg (%)")).toHaveText("-0.42");
      await expect(await cell(page, "RELIANCE", "Chg (%)")).toHaveText("+2.08");
      await expect(await cell(page, "HDFCBANK", "Volume (shares)")).toHaveText("10,00,000");
      await expect(await cell(page, "HDFCBANK", "Market cap (₹ Cr)")).toHaveText("12,50,000.00");

      // Null market cap and volume, and a price with no quote and no stored value, are "—", never 0.
      await expectMissing(page, "KPITTECH", "Market cap (₹ Cr)");
      await expectMissing(page, "KPITTECH", "Volume (shares)");
      await expectMissing(page, "TATAELXSI", "Price (₹)");

      await page.getByRole("button", { name: "Valuation" }).click();
      await expect(page.getByRole("columnheader", { name: "P/E (x)", exact: true })).toBeAttached();
      await expect(await cell(page, "HDFCBANK", "P/E (x)")).toHaveText("19.10");
      await expectMissing(page, "INFY", "P/E (x)");
    });

    test("mixed sources and stale timestamps show per row; a filter reports rows it dropped for missing data", async ({ page, api }) => {
      api.screenerRows = withNulls({
        HDFCBANK: { fundamentalsSource: "yahoo_quote_summary", fundamentalsAsOf: "2026-09-30T00:00:00.000Z" },
        INFY: {
          pe: null,
          fundamentalsSource: "company_snapshot",
          fundamentalsAsOf: "2026-05-01T00:00:00.000Z",
          staleFundamentals: true,
        },
        TATAELXSI: { price: null },
      });
      await serveMixedQuotes(page);
      await page.goto("/screener");

      const provenance = page.getByLabel("Data source and as-of time");
      await expect(provenance).toContainText("Price: source and as-of time vary by row");
      await expect(provenance).toContainText("Fundamentals: source and as-of time vary by row");

      const header = "Source · as of";
      await expect(await cell(page, "HDFCBANK", header)).toHaveText(
        /^Price: Angel One · live · 06 Nov, 15:45 ISTFundamentals: Yahoo Finance · quote summary · 30 Sept? 2026$/,
      );
      await expect(await cell(page, "KPITTECH", header)).toHaveText(
        "Price: Yahoo · delayed · 30 Oct, 15:30 ISTStaleFundamentals: Stored database snapshot · 05 Nov 2026",
      );
      await expect(await cell(page, "TATAELXSI", header)).toContainText("Price: not available");
      await expect(await cell(page, "INFY", header)).toContainText("Fundamentals: Stored company snapshot · 01 May 2026Stale");

      await page.getByRole("button", { name: "Advanced filters" }).click();
      await page.getByLabel("Max P/E").fill("30");
      await expect.poll(() => lastCompaniesQuery(api)).toMatchObject({ pe_max: "30" });
      // INFY has no P/E: it is left out and counted, not matched as if its P/E were 0.
      await expect(page.locator("tbody tr td:nth-child(2) > button")).toHaveText([/^HDFCBANK/, /^RELIANCE/, /^TCS/]);
      await expect(page.getByText(/^3 results$/)).toBeVisible();
      await expect(page.getByText("1 row excluded for missing data (P/E 1)")).toBeVisible();

      await page.getByLabel("Max P/E").fill("");
      await expect(page.getByText(/excluded for missing data/)).toHaveCount(0);
    });

    test("a uniform source and as-of time is stated once in the header", async ({ page }) => {
      await page.goto("/screener");
      const provenance = page.getByLabel("Data source and as-of time");
      await expect(provenance).toContainText("Price: Angel One · live · 06 Nov, 15:45 IST");
      await expect(provenance).toContainText("Fundamentals: Stored database snapshot · 05 Nov 2026");
      await expect(page.getByRole("columnheader", { name: "Source · as of" })).toHaveCount(0);
    });

    test("signed out, saved screens say they need an account instead of offering a save that cannot work", async ({ page, api }) => {
      await page.goto("/screener");
      await expect(page.locator("tbody tr")).toHaveCount(COMPANIES.length);
      await expect(page.getByRole("button", { name: "Save as new" })).toBeDisabled();
      await page.getByRole("button", { name: /^Saved\b/ }).click();
      await expect(page.getByText("Saved screens require a signed-in account.")).toBeVisible();
      await expect(page.getByText(/^No account saved views/)).toHaveCount(0);
      expect(api.trpcCalls("workspace.saveScreener")).toEqual([]);
    });

    test("a saved screen can be saved, renamed, restored with its filters and sort, and deleted", async ({ page, api }) => {
      await signIn(page);
      await page.goto("/screener");
      await expect(page.locator("tbody tr")).toHaveCount(COMPANIES.length);

      await page.getByRole("button", { name: "Advanced filters" }).click();
      await page.getByLabel("Max P/E").fill("30");
      const marketCapHeader = page.getByRole("columnheader").getByRole("button", { name: "Market cap (₹ Cr)", exact: true });
      await marketCapHeader.click();
      await marketCapHeader.click();
      const savedQuery = { pe_max: "30", sortBy: "market_cap", sortDir: "desc" };
      await expect.poll(() => lastCompaniesQuery(api)).toMatchObject(savedQuery);
      const savedOrder = [/^RELIANCE/, /^TCS/, /^HDFCBANK/, /^INFY/];
      await expect(page.locator("tbody tr td:nth-child(2) > button")).toHaveText(savedOrder);

      // Save as new.
      await page.getByRole("button", { name: "Save as new" }).click();
      await page.getByPlaceholder("Saved view name").fill("Cheap large caps");
      await page.locator("form").getByRole("button", { name: "Save as new" }).click();
      await expect(page.getByText("Saved “Cheap large caps” to your account.")).toBeVisible();
      expect(api.savedScreeners.map(({ name, criteria }) => ({ name, criteria }))).toEqual([
        {
          name: "Cheap large caps",
          criteria: { schemaVersion: 1, filters: { pe_max: "30" }, view: "overview", sortBy: "market_cap", sortDir: "desc", hiddenColumns: [] },
        },
      ]);

      // Rename.
      await page.getByRole("button", { name: "Rename" }).click();
      const nameInput = page.locator("form input");
      await expect(nameInput).toHaveValue("Cheap large caps");
      await nameInput.fill("Value screen");
      await page.getByRole("button", { name: "Save name for Cheap large caps" }).click();
      await expect(page.getByText("Saved view renamed.")).toBeVisible();
      await expect(page.getByText("Value screen", { exact: true })).toHaveCount(2); // header badge and list entry
      expect(api.savedScreeners[0]?.name).toBe("Value screen");

      // Move away from the saved state, then restore it. Both pages are cached by then, so the
      // rows (filter and order) show what is applied rather than a new request.
      const rows = page.locator("tbody tr td:nth-child(2) > button");
      await page.getByRole("button", { name: "All stocks" }).click();
      await expect(rows).toHaveText(COMPANIES.map((company) => new RegExp(`^${company.symbol}`)));
      await expect(page.getByText("Unsaved changes")).toBeVisible();
      await expect(page.getByLabel("Max P/E")).toHaveValue("");

      await page.getByRole("button", { name: "Apply" }).click();
      await expect(rows).toHaveText(savedOrder);
      await expect(page.getByLabel("Max P/E")).toHaveValue("30");
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);

      // Delete.
      await page.getByRole("button", { name: /^Saved\b/ }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Saved view deleted.")).toBeVisible();
      await expect(page.getByText(/^No account saved views/)).toBeVisible();
      await expect(page.getByText("Value screen", { exact: true })).toHaveCount(0);
      expect(api.savedScreeners[0]?.isArchived).toBe(true);
    });
  });
}
