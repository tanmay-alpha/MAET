import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const routePath = join(import.meta.dir, "_app.watchlists.tsx");
const routeSource = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const panelSource = readFileSync(
  join(import.meta.dir, "../components/workspace/watchlist-panel.tsx"),
  "utf8",
);
const sidebarSource = readFileSync(
  join(import.meta.dir, "../components/app-sidebar.tsx"),
  "utf8",
);
const featureSource = `${routeSource}\n${panelSource}`;

describe("Watchlists route integrity", () => {
  it("provides a dedicated Watchlists destination without replacing Terminal", () => {
    expect(existsSync(routePath)).toBe(true);
    expect(routeSource).toContain('createFileRoute("/_app/watchlists")');
    expect(sidebarSource).toMatch(/title:\s*"Watchlists",\s*url:\s*"\/watchlists"/u);
    expect(sidebarSource).toMatch(/title:\s*"Terminal",\s*url:\s*"\/terminal"/u);
  });

  it("uses canonical account workspace operations for every watchlist action", () => {
    for (const operation of [
      "createWatchlist",
      "renameWatchlist",
      "deleteWatchlist",
      "addWatchlistItem",
      "removeWatchlistItem",
      "updateWatchlistItemNote",
    ]) {
      expect(featureSource).toContain(operation);
    }
    expect(featureSource).not.toContain("portfolio.getWatchlist");
  });

  it("keeps unavailable quote values explicit", () => {
    expect(featureSource).toContain("useMarketQuotes");
    expect(featureSource).toContain("—");
    expect(featureSource).not.toMatch(/quote\?\.(price|changePercent)\s*(\?\?|\|\|)\s*0/u);
  });
});
