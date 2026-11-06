import type { Page } from "@playwright/test";
import { COMPANIES } from "./support/data";
import { test, expect } from "./support/fixtures";
import type { MockApi } from "./support/mock-api";

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
