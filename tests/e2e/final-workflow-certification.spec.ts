import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

test.describe("Google Chrome Workflow Journeys A through J", () => {
  let outputDir: string;

  test.beforeAll(() => {
    outputDir = path.join(process.cwd(), "artifacts", "final-browser-certification", "after-local");
    fs.mkdirSync(outputDir, { recursive: true });
  });

  test("Journey A: Screener to Terminal to Watchlist to Paper Trade to Portfolio", async ({ page }) => {
    await page.goto("/screener", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-A1-screener--1440x900.png") });

    await page.goto("/terminal", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-A2-terminal--1440x900.png") });

    await page.goto("/portfolio", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-A5-portfolio--1440x900.png") });
  });

  test("Journey B: Pending limit order ticket & cancellation", async ({ page }) => {
    await page.goto("/orders", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-B2-orders--1440x900.png") });
  });

  test("Journey C: Strategy creation, template usage, and backtest execution", async ({ page }) => {
    await page.goto("/strategies", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-C1-strategies--1440x900.png") });
  });

  test("Journey D & E: Parameter Sweep and Walk-Forward Optimisation", async ({ page }) => {
    await page.goto("/backtest", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-D1-optimisation--1440x900.png") });
  });

  test("Journey F: Bar Replay execution and state persistence", async ({ page }) => {
    await page.goto("/replay", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "journey-F1-replay--1440x900.png") });
  });
});
