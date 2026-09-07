import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTabMetricValue } from "./_app.compare";

const routePath = join(import.meta.dir, "_app.compare.tsx");
const trpcClientPath = join(import.meta.dir, "../lib/trpc.ts");
const routeSource = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const trpcSource = existsSync(trpcClientPath) ? readFileSync(trpcClientPath, "utf8") : "";

describe("Compare route integrity and peer contract", () => {
  it("uses canonical companies.getPeerComparison query procedure", () => {
    expect(routeSource).toContain("trpc.companies.getPeerComparison.query");
    expect(routeSource).not.toContain("trpc.analysis.getPeerComparison");
  });

  it("strongly types companies.getPeerComparison in trpc client without any", () => {
    expect(trpcSource).toContain("companies.getPeerComparison");
    expect(trpcSource).toContain("PeerComparisonRequest");
    expect(trpcSource).toContain("PeerComparisonResult");
    expect(trpcSource).not.toContain('query: (input: { symbol: string }): Promise<any> => trpcQuery("companies.getPeerComparison"');
  });

  it("surfaces deterministic peer selection basis (industry, sector fallback, none)", () => {
    expect(routeSource).toContain("peerData?.selectionBasis === \"industry\"");
    expect(routeSource).toContain("Industry Peers");
    expect(routeSource).toContain("peerData?.selectionBasis === \"sector\"");
    expect(routeSource).toContain("Sector Fallback");
    expect(routeSource).toContain("Selected Peers");
  });

  it("does not fabricate 'Live' timestamp fallback", () => {
    expect(routeSource).not.toContain(': "Live"');
    expect(routeSource).not.toContain("? \"Live\"");
    expect(routeSource).toContain("As of: {peerData?.asOf ?");
  });

  it("surfaces peer median and comparison median truthfully", () => {
    expect(routeSource).toContain("Peer Median");
    expect(routeSource).toContain("Comparison Median");
    expect(routeSource).toContain("peerData.comparisonMedian");
  });

  it("does not use any for peer mapping", () => {
    expect(routeSource).toContain("peer: PeerComparisonEntry");
    expect(routeSource).not.toContain("peer: any");
  });

  it("formats missing metrics as '—' and never fabricates 0 or 0.0%", () => {
    expect(getTabMetricValue(null, "Performance")).toBe("—");
    expect(getTabMetricValue({}, "Valuation")).toBe("—");
    expect(getTabMetricValue({ metrics: {} }, "Valuation")).toBe("—");
    expect(getTabMetricValue({ metrics: { peRatio: undefined } }, "Valuation")).toBe("—");
    expect(getTabMetricValue({ metrics: { roe: undefined } }, "Profitability")).toBe("—");
    expect(getTabMetricValue({ metrics: { revenueGrowth: undefined } }, "Growth")).toBe("—");
    expect(getTabMetricValue({ metrics: { debtToEquity: undefined } }, "Leverage")).toBe("—");
    expect(getTabMetricValue({ metrics: { relativeVolume: undefined } }, "Momentum")).toBe("—");
    expect(getTabMetricValue({ metrics: { marketCap: undefined } }, "Performance")).toBe("—");

    // Real valid values format accurately
    expect(getTabMetricValue({ metrics: { peRatio: 24.5 } }, "Valuation")).toBe("P/E: 24.5");
    expect(getTabMetricValue({ metrics: { roe: 0.185 } }, "Profitability")).toBe("ROE: 18.5%");
  });
});
