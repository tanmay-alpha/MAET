import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { MockApi } from "./support/mock-api";

const CONDOR_PREMIUMS = ["10", "30", "32", "12"];

function summaryValue(page: Page, label: RegExp): Locator {
  return page
    .getByRole("region", { name: /^summary/i })
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd");
}

async function expectCondorSummary(page: Page) {
  // NIFTY lot 65, 1 lot; strikes 23800/23900/24100/24200; net credit 30 + 32 − 10 − 12 = 40.
  await expect(summaryValue(page, /^max profit$/i)).toHaveText("₹2,600");
  await expect(summaryValue(page, /^max loss$/i)).toHaveText("−₹3,900");
  await expect(summaryValue(page, /^net credit$/i)).toHaveText("₹2,600");
  await expect(summaryValue(page, /^breakevens$/i)).toHaveText("23,860.00 · 24,140.00");
  await expect(summaryValue(page, /^risk : reward$/i)).toHaveText("1 : 0.67");
}

test("payoff lab: an iron condor from a template shows exact risk figures, a chart, and survives a shared URL", async ({
  page,
  browser,
}) => {
  await page.goto("/payoff");
  // Once hydrated the lab writes its state, including the default expiry, to the URL.
  await expect(page).toHaveURL(/[?&]exp=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("heading", { level: 1, name: "Payoff Lab" })).toBeVisible();
  await expect(page.getByText("Prices are your inputs, not live quotes.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^lot size/i })).toHaveValue("65");
  await expect(page.getByRole("textbox", { name: /^strike step/i })).toHaveValue("50");

  const template = page.getByRole("combobox", { name: "Strategy template" });
  await expect(template).toBeDisabled();
  await page.getByRole("textbox", { name: /^spot/i }).fill("24010");
  await template.selectOption("Iron condor");

  for (const [index, strike] of ["23800", "23900", "24100", "24200"].entries()) {
    await expect(page.getByRole("textbox", { name: `Leg ${index + 1} strike` })).toHaveValue(strike);
    await expect(page.getByRole("textbox", { name: `Leg ${index + 1} premium` })).toHaveValue("");
  }
  await expect(page.getByText("Fill in the highlighted inputs to see the payoff.")).toBeVisible();

  for (const [index, premium] of CONDOR_PREMIUMS.entries()) {
    await page.getByRole("textbox", { name: `Leg ${index + 1} premium` }).fill(premium);
  }

  await expectCondorSummary(page);
  const chart = page.getByRole("img", { name: /^payoff chart/i });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(2);
  await expect(chart.getByText("BE 23,860")).toBeVisible();
  await expect(page.getByRole("region", { name: /^scenarios/i }).getByRole("row")).toHaveCount(10);

  await expect(page).toHaveURL(/legs=B_PE_23800_1_10(~|%7E)S_PE_23900_1_30(~|%7E)S_CE_24100_1_32(~|%7E)B_CE_24200_1_12/);
  const sharedUrl = page.url();

  // A fresh browser has no saved session, so only the URL can restore the legs.
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, locale: "en-IN" });
  try {
    const visitor = await context.newPage();
    await new MockApi(visitor).install();
    await visitor.goto(sharedUrl);
    for (const [index, premium] of CONDOR_PREMIUMS.entries()) {
      await expect(visitor.getByRole("textbox", { name: `Leg ${index + 1} premium` })).toHaveValue(premium);
    }
    await expect(visitor.getByRole("textbox", { name: /^spot/i })).toHaveValue("24010");
    await expectCondorSummary(visitor);
  } finally {
    await context.close();
  }

  // Without search params the lab resumes the last session from this browser.
  await page.goto("/payoff");
  await expect(page.getByRole("textbox", { name: "Leg 4 premium" })).toHaveValue("12");
  await expectCondorSummary(page);
});
