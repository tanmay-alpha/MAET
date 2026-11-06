import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { BASE_PRICES } from "./support/data";
import { test, expect } from "./support/fixtures";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/**
 * Opens /import ready for a file. A change event fired before hydration is lost, so wait until
 * React has attached its props to the input (re-selecting instead would restart the chunked read
 * on every retry).
 */
async function openImport(page: Page) {
  await page.goto("/import");
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input !== null && Object.keys(input).some((key) => key.startsWith("__reactProps"));
  });
}

/** Every request the page makes, to any origin, with its body: file contents must never appear in one. */
function recordOutgoing(page: Page) {
  const outgoing: string[] = [];
  page.on("request", (request) => outgoing.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`));
  return outgoing;
}

async function downloadText(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), "utf8") };
}

test("sample tradebook: row counts, realised gains per FY, quote-filled prices and XIRR", async ({ page, api }) => {
  await page.goto("/import");
  await expect(page.getByText("Your file is read in this browser tab only. Nothing is sent or stored.")).toBeVisible();

  // The page is server-rendered, so the first click can land before React attaches its handler.
  await expect(async () => {
    await page.getByRole("button", { name: "Load sample tradebook" }).click();
    await expect(page.getByText("Sample data", { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(page.getByLabel("File format")).toHaveValue("zerodha");
  await page.getByRole("button", { name: "Review rows" }).click();

  await expect(page.getByTestId("count-all")).toHaveText("15");
  await expect(page.getByTestId("count-accepted")).toHaveText("9");
  await expect(page.getByTestId("count-rejected")).toHaveText("5");
  await expect(page.getByTestId("count-duplicate")).toHaveText("1");
  for (const reason of ["F&O segment excluded", 'Bad date "2024-02-30"', "Zero quantity", "Sell without prior buy: 10 sold, 0 held", 'Unknown side "transfer"']) {
    await expect(page.getByRole("cell", { name: reason, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "See results" }).click();
  // RELIANCE is sold without a buy in the file: the results say whose history is incomplete.
  await expect(page.getByTestId("partial-history")).toContainText("History incomplete for RELIANCE");
  await page.getByRole("tab", { name: /Realised/ }).click();
  await expect(page.getByLabel("Financial year")).toHaveValue("2025");
  await page.getByLabel("Financial year").selectOption("2024");
  await expect(page.getByTestId("realised-total")).toHaveText("₹3,317.50");
  await expect(page.getByText("Tax · estimate, not tax advice")).toBeVisible();

  await page.getByRole("tab", { name: "Cash flows" }).click();
  await expect(page.getByTestId("xirr-status")).toContainText("Enter a current price for HDFCBANK, INFY, ITC, TCS");

  const quoteRequestsBefore = api.requests.filter((entry) => entry.url.pathname === "/api/market/quotes").length;
  await page.getByRole("tab", { name: /Holdings/ }).click();
  await page.getByRole("button", { name: "Fill from MAET quotes" }).click();
  await expect(page.getByText(/Filled 4 of 4 from Angel One quotes as of/)).toBeVisible();
  await expect(page.getByLabel("Current price of INFY")).toHaveValue(String(BASE_PRICES.INFY));
  const quoteRequest = api.requests.filter((entry) => entry.url.pathname === "/api/market/quotes").at(quoteRequestsBefore);
  expect(quoteRequest?.url.searchParams.get("symbols")).toBe("HDFCBANK,INFY,ITC,TCS");

  // A typed price overrides the quote.
  await page.getByLabel("Current price of ITC").fill("500");
  await page.getByRole("tab", { name: "Cash flows" }).click();
  await expect(page.getByText("XIRR · annualised, gross")).toBeVisible();
  await expect(page.getByTestId("xirr-status")).toContainText("open holdings count as an inflow today");
  await expect(page.locator("dd").first()).toHaveText(/^-?\d+\.\d{2}%$/);
});

test("uploads a Groww order history with BOM, CRLF and quoted values, sending none of it", async ({ page, api }) => {
  const outgoing = recordOutgoing(page);
  await openImport(page);
  await page.getByLabel("Tradebook CSV file").setInputFiles(fixture("groww-orders.csv"));
  await expect(page.getByText("groww-orders.csv", { exact: true })).toBeVisible();
  await expect(page.getByLabel("File format")).toHaveValue("groww");
  await page.getByRole("button", { name: "Review rows" }).click();

  await expect(page.getByTestId("count-all")).toHaveText("4");
  await expect(page.getByTestId("count-accepted")).toHaveText("3");
  await expect(page.getByRole("cell", { name: 'Order status "Cancelled" excluded' })).toBeVisible();

  await page.getByRole("button", { name: "See results" }).click();
  await expect(page.getByRole("cell", { name: "ITC", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Realised/ }).click();
  await expect(page.getByTestId("realised-total")).toHaveText("₹478.00");
  await expect(page.getByRole("cell", { name: "STCG", exact: true })).toBeVisible();
  expect(outgoing.filter((entry) => /INE009A01021|INE154A01025|14,805|Infosys Ltd/.test(entry))).toEqual([]);
  expect(api.requests.filter((entry) => entry.method !== "GET")).toEqual([]);
});

test("exports formula-looking symbols from the file as text and figures as numbers, uploading nothing", async ({ page, api }) => {
  const outgoing = recordOutgoing(page);
  await openImport(page);
  await page.getByLabel("Tradebook CSV file").setInputFiles(fixture("formula-symbols.csv"));
  await expect(page.getByLabel("File format")).toHaveValue("zerodha");
  await page.getByRole("button", { name: "Review rows" }).click();
  await expect(page.getByTestId("count-accepted")).toHaveText("3");
  await page.getByRole("button", { name: "See results" }).click();

  const holdings = await downloadText(page);
  expect(holdings.name).toBe("holdings.csv");
  expect(holdings.text.split("\r\n")).toEqual([
    "\uFEFFsymbol,quantity,avg_cost,invested,oldest_lot,ltcg_eligible_from,all_lots_ltcg_from,current_price,unrealised",
    "'-2+3,5,200,1000,2024-01-11,2025-01-12,2025-01-12,,",
  ]);

  await page.getByRole("tab", { name: /Realised/ }).click();
  await expect(page.getByTestId("realised-total")).toHaveText("−₹95.00");
  const realised = await downloadText(page);
  expect(realised.name).toBe("realised-2023-24.csv");
  expect(realised.text.split("\r\n")).toEqual([
    "\uFEFFsymbol,quantity,buy_date,sell_date,buy_value,sell_value,gain,term",
    `"'=HYPERLINK(""HTTPS://EVIL.TEST"",""X"")",10,2024-01-10,2024-02-12,1000,905,-95,STCG`,
  ]);

  expect(outgoing.filter((entry) => /evil\.test|HYPERLINK|INE000000001|INE000000002/i.test(entry))).toEqual([]);
  expect(api.requests.filter((entry) => entry.method !== "GET")).toEqual([]);
});

test("refuses a file over the size limit before reading it", async ({ page, api }) => {
  await openImport(page);
  await page.getByLabel("Tradebook CSV file").setInputFiles({ name: "tradebook.csv", mimeType: "text/csv", buffer: Buffer.alloc(26 * 1024 * 1024, "a") });
  await expect(page.getByRole("alert")).toHaveText("Could not read the file: The file is 26.0 MB; the limit is 25 MB. Export one financial year at a time.");
  await expect(page.getByRole("button", { name: "Review rows" })).toHaveCount(0);
  expect(api.requests.filter((entry) => entry.method !== "GET")).toEqual([]);
});

test("reads Excel 'Unicode text' (UTF-16 LE, tab-separated)", async ({ page }) => {
  await openImport(page);
  await page.getByLabel("Tradebook CSV file").setInputFiles(fixture("excel-unicode-text.txt"));
  await expect(page.getByText("2 data rows · read as UTF-16 LE, tab-separated · detected Zerodha Console tradebook")).toBeVisible();
  await page.getByRole("button", { name: "Review rows" }).click();
  await expect(page.getByTestId("count-accepted")).toHaveText("2");
  await page.getByRole("button", { name: "See results" }).click();
  await page.getByRole("tab", { name: /Realised/ }).click();
  await expect(page.getByTestId("realised-total")).toHaveText("₹249.00");
});

test("an unrecognised broker export asks for a column mapping and guesses the exact headers", async ({ page }) => {
  await openImport(page);
  await page.getByLabel("Tradebook CSV file").setInputFiles(fixture("upstox-trades.csv"));
  await expect(page.getByText("2 data rows · format not recognised: map the columns below")).toBeVisible();
  await expect(page.getByLabel("File format")).toHaveValue("generic");
  await expect(page.getByLabel("Buy / sell column")).toHaveValue("11");
  await expect(page.getByLabel("Price column")).toHaveValue("13");
  await page.getByRole("button", { name: "Review rows" }).click();
  await expect(page.getByTestId("count-accepted")).toHaveText("2");
});
