import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

if (process.argv.includes("--help")) {
  console.log("Run against the real local stack: bun run scripts/audit-local-journey.ts");
  console.log("Optional: JOURNEY_BASE_URL (http://127.0.0.1:4441), JOURNEY_OUTPUT (test-results/journey)");
  process.exit(0);
}

const baseUrl = process.env.JOURNEY_BASE_URL ?? "http://127.0.0.1:4441";
const output = path.resolve(process.env.JOURNEY_OUTPUT ?? "test-results/journey");
const routes = [
  "/screener", "/watchlists", "/world", "/terminal", "/orders", "/portfolio", "/import",
  "/journal", "/alerts", "/strategies", "/research/reports", "/performance", "/replay",
  "/payoff", "/admin/data-quality", "/data-quality", "/settings", "/chart-grid", "/compare",
  "/universe", "/heatmap", "/backtest", "/options/RELIANCE", "/futures", "/news",
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [360, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    try {
      const page = await context.newPage();
      const results = [];
      for (const route of routes) {
        const errors: string[] = [];
        const failed: Array<{ url: string; status?: number; error?: string }> = [];
        const onConsole = (message: { type(): string; text(): string }) => {
          if (message.type() === "error") errors.push(message.text());
        };
        const onError = (error: Error) => errors.push(error.message);
        const onResponse = (response: { status(): number; url(): string }) => {
          if (response.status() >= 400) failed.push({ url: response.url(), status: response.status() });
        };
        const onFailed = (request: { url(): string; failure(): { errorText: string } | null }) => {
          const error = request.failure()?.errorText;
          if (error && !error.includes("ABORTED")) failed.push({ url: request.url(), error });
        };
        page.on("console", onConsole);
        page.on("pageerror", onError);
        page.on("response", onResponse);
        page.on("requestfailed", onFailed);
        let navigationError: string | null = null;
        try {
          await page.goto(new URL(route, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
          // SSE stays open. Bound the settling wait instead of requiring network-idle forever.
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
          const state = await page.evaluate(() => ({
            text: document.body.innerText,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }));
          const screenshot = `${route.slice(1).replaceAll("/", "-")}-${width}.png`;
          await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
          const focus = [];
          for (let step = 0; step < 5; step++) {
            await page.keyboard.press("Tab");
            focus.push(await page.evaluate(() => ({
              tag: document.activeElement?.tagName,
              label: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.slice(0, 80),
            })));
          }
          results.push({ route, width, ...state, screenshot, focus, errors, failed });
        } catch (error) {
          navigationError = String(error);
          results.push({ route, width, navigationError, errors, failed });
        } finally {
          page.off("console", onConsole);
          page.off("pageerror", onError);
          page.off("response", onResponse);
          page.off("requestfailed", onFailed);
        }
        await writeFile(path.join(output, `audit-${width}.json`), JSON.stringify(results, null, 2));
        console.log(`${width}px ${route}${navigationError ? `: ${navigationError}` : ": captured"}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Local evidence: ${output}. Manually inspect screenshots and exercise controls; capture is not a product assertion.`);
