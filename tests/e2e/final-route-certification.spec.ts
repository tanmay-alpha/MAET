import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const targetRoutes = [
  { path: "/", name: "landing" },
  { path: "/screener", name: "screener" },
  { path: "/terminal", name: "terminal" },
  { path: "/stock/RELIANCE", name: "stock-detail" },
  { path: "/chart/RELIANCE", name: "chart-standalone" },
  { path: "/compare", name: "compare" },
  { path: "/chart-grid", name: "chart-grid" },
  { path: "/news", name: "news" },
  { path: "/heatmap", name: "heatmap" },
  { path: "/futures", name: "futures" },
  { path: "/options/NIFTY", name: "options" },
  { path: "/workspace", name: "workspace" },
  { path: "/orders", name: "orders" },
  { path: "/portfolio", name: "portfolio" },
  { path: "/alerts", name: "alerts" },
  { path: "/journal", name: "journal" },
  { path: "/strategies", name: "strategies-library" },
  { path: "/backtest", name: "backtest" },
  { path: "/replay", name: "replay" },
  { path: "/performance", name: "performance" },
  { path: "/dashboard", name: "dashboard" },
  { path: "/universe", name: "universe" },
  { path: "/settings", name: "settings" },
  { path: "/admin/data-quality", name: "admin-data-quality" },
];

test.describe("Google Chrome Route Certification Suite", () => {
  for (const r of targetRoutes) {
    test(`Certify route: ${r.path}`, async ({ page, project }, testInfo) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      page.on("pageerror", (err) => {
        consoleErrors.push(err.message);
      });

      page.on("requestfailed", (req) => {
        failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`);
      });

      // Navigate to route
      const response = await page.goto(r.path, { waitUntil: "networkidle", timeout: 30000 });
      expect(response?.status()).toBeLessThan(400);

      // Verify no white screen body
      const bodyText = await page.innerText("body");
      expect(bodyText.trim().length).toBeGreaterThan(0);

      // Ensure evidence directory exists
      const viewport = project.use.viewport || { width: 1440, height: 900 };
      const outputDir = path.join(process.cwd(), "artifacts", "final-browser-certification", "after-local");
      fs.mkdirSync(outputDir, { recursive: true });

      const fileName = `${r.name}--ready--${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path: path.join(outputDir, fileName), fullPage: false });

      // Assert clean console
      const criticalErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("source map"));
      expect(criticalErrors).toEqual([]);
    });
  }
});
