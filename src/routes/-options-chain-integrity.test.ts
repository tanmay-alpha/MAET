import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(join(import.meta.dir, "_app.options.$underlying.tsx"), "utf8");
const greekDisplaySource = readFileSync(join(import.meta.dir, "../components/options/greek-display.tsx"), "utf8");

describe("persisted options-chain route integrity", () => {
  it("uses persisted option procedures instead of disconnected-provider copy or demo data", () => {
    expect(routeSource).not.toContain("Verified NSE derivatives provider is not connected yet");
    expect(routeSource).toContain("options.listExpiries");
    expect(routeSource).toContain("options.getLatestChain");
    expect(routeSource).not.toMatch(/\bDEMO\b/u);
    expect(routeSource).not.toMatch(/\bPCR\b|Max Pain|ATM IV|IV percentile|expected move|OI change/u);
  });

  it("keeps missing values, persisted expiry selection, and source provenance explicit", () => {
    expect(routeSource).toContain('const UNAVAILABLE = "—"');
    expect(routeSource).toContain("selectedExpiry");
    expect(routeSource).toContain("Angel One / NFO");
    expect(routeSource).toContain("Greeks observed");
  });

  it("renders only provider-supported Greeks", () => {
    expect(greekDisplaySource).toContain("Delta");
    expect(greekDisplaySource).toContain("Gamma");
    expect(greekDisplaySource).toContain("Theta");
    expect(greekDisplaySource).toContain("Vega");
    expect(greekDisplaySource).not.toMatch(/\bRho\b/u);
  });
});
