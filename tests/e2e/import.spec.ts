import { fileURLToPath } from "node:url";
import { BASE_PRICES } from "./support/data";
import { test, expect } from "./support/fixtures";

const GROWW_FIXTURE = fileURLToPath(new URL("./fixtures/groww-orders.csv", import.meta.url));

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

test("uploads a Groww order history with BOM, CRLF and quoted values", async ({ page }) => {
  await page.goto("/import");
  // A change event fired before hydration is lost. Wait until React has attached its props to
  // the input (re-selecting instead would restart the chunked read on every retry).
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input !== null && Object.keys(input).some((key) => key.startsWith("__reactProps"));
  });
  await page.getByLabel("Tradebook CSV file").setInputFiles(GROWW_FIXTURE);
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
});
