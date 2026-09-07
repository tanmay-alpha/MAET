import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const heatmapRoutePath = join(import.meta.dir, "_app.heatmap.tsx");
const heatmapCompPath = join(import.meta.dir, "../components/trading/market-heatmap.tsx");
const gaugeCompPath = join(import.meta.dir, "../components/trading/breadth-gauge.tsx");

const heatmapRouteSource = existsSync(heatmapRoutePath) ? readFileSync(heatmapRoutePath, "utf8") : "";
const heatmapCompSource = existsSync(heatmapCompPath) ? readFileSync(heatmapCompPath, "utf8") : "";
const gaugeCompSource = existsSync(gaugeCompPath) ? readFileSync(gaugeCompPath, "utf8") : "";

describe("Market Intelligence Integrity Suite (Heatmap + Breadth)", () => {
  it("1. Heatmap does NOT use hardcoded COMPONENTS or static weights", () => {
    expect(heatmapCompSource).not.toContain("const COMPONENTS");
    expect(heatmapCompSource).not.toContain('{ sym: "RELIANCE", w: 18 }');
  });

  it("2. Heatmap wires directly to marketBreadth.getHeatmapCells", () => {
    expect(heatmapCompSource).toContain("trpc.marketBreadth.getHeatmapCells.query");
    expect(heatmapCompSource).toContain('universe: "ALL_NSE"');
  });

  it("3. Breadth gauge wires to marketBreadth.getOverview, NOT WATCHLIST", () => {
    expect(gaugeCompSource).toContain("trpc.marketBreadth.getOverview.query");
    expect(gaugeCompSource).not.toContain("import { WATCHLIST }");
    expect(gaugeCompSource).not.toContain("WATCHLIST.map");
  });

  it("4. Heatmap route does NOT claim false 'NIFTY 50' or have inert buttons", () => {
    expect(heatmapRouteSource).not.toContain("NIFTY 50 — weighted by market cap");
    expect(heatmapRouteSource).not.toContain("<button className=\"rounded px-2.5 py-1 text-muted-foreground hover:text-foreground\">BANK NIFTY</button>");
    expect(heatmapRouteSource).toContain("NSE Verified Market Heatmap");
    expect(heatmapRouteSource).toContain("ALL_NSE Verified");
  });

  it("5. Heatmap route does NOT use fake Loadable delay timers", () => {
    expect(heatmapRouteSource).not.toContain("Loadable delay={700}");
    expect(heatmapRouteSource).not.toContain("Loadable delay={900}");
    expect(heatmapRouteSource).not.toContain("<Loadable");
  });

  it("6. Breadth gauge handles null advance-decline ratio truthfully as '—'", () => {
    expect(gaugeCompSource).toContain("data.advanceDeclineRatio !== null");
    expect(gaugeCompSource).toContain(': "—"');
  });

  it("7. Breadth gauge displays verified quote coverage truthfully", () => {
    expect(gaugeCompSource).toContain("data.companiesWithUsableQuote");
    expect(gaugeCompSource).toContain("data.eligibleCompanies");
    expect(gaugeCompSource).toContain("data.quoteCoverage");
  });

  it("8. Breadth gauge surfaces SMA indicator percentages with eligible counts", () => {
    expect(gaugeCompSource).toContain("data.pctAboveSma20");
    expect(gaugeCompSource).toContain("data.sma20Eligible");
    expect(gaugeCompSource).toContain("data.pctAboveSma50");
    expect(gaugeCompSource).toContain("data.pctAboveSma200");
  });

  it("9. Heatmap cell layout is proportional to verified market cap weight", () => {
    expect(heatmapCompSource).toContain("c.weight > 0 ? c.weight : 0.5");
    expect(heatmapCompSource).toContain("computeLayout");
    expect(heatmapCompSource).toContain("b.weight - a.weight");
  });

  it("10. Heatmap clamps visual color intensity while displaying actual changePct", () => {
    expect(heatmapCompSource).toContain("Math.max(-3, Math.min(3, chg))");
    expect(heatmapCompSource).toContain("r.changePct.toFixed(2)");
  });

  it("11. Provenance timestamp is surfaced to the user in the route", () => {
    expect(heatmapRouteSource).toContain("overview?.asOf");
    expect(heatmapRouteSource).toContain("As of:");
  });

  it("12. Graceful fallback on loading and unavailable states", () => {
    expect(heatmapCompSource).toContain("Loading verified market cells");
    expect(heatmapCompSource).toContain("Verified market intelligence temporarily unavailable");
    expect(gaugeCompSource).toContain("Loading verified market breadth");
  });
});
