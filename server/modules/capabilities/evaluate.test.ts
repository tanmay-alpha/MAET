import { describe, it, expect } from "bun:test";
import { evaluateCapabilities } from "./service";
import { ALL_CAPABILITIES } from "./contracts";

describe("capabilities evaluation", () => {
  it("returns one state per capability", () => {
    const states = evaluateCapabilities({
      hasAuthenticatedSession: true,
      schemaAvailable: true,
    });
    expect(states).toHaveLength(ALL_CAPABILITIES.length);
    for (const c of ALL_CAPABILITIES) {
      expect(states.find((s) => s.key === c)).toBeDefined();
    }
  });

  it("disables authenticated features when caller is not signed in", () => {
    const states = evaluateCapabilities({
      hasAuthenticatedSession: false,
      schemaAvailable: true,
    });
    const cloud = states.find((s) => s.key === "cloudWorkspace");
    expect(cloud?.available).toBe(false);
    expect(cloud?.reason).toContain("sign in");
  });

  it("disables schema-dependent features when schema unavailable", () => {
    const states = evaluateCapabilities({
      hasAuthenticatedSession: true,
      schemaAvailable: false,
    });
    const heatmap = states.find((s) => s.key === "dynamicHeatmap");
    expect(heatmap?.available).toBe(false);
    expect(heatmap?.reason).toBeDefined();
  });

  it("keeps derivatives and liveNews disabled until verified providers connected", () => {
    const states = evaluateCapabilities({
      hasAuthenticatedSession: true,
      schemaAvailable: true,
    });
    const derivatives = states.find((s) => s.key === "derivatives");
    const news = states.find((s) => s.key === "liveNews");
    expect(derivatives?.available).toBe(false);
    expect(news?.available).toBe(false);
  });

  it("enables scorecard and screener DSL when schema is available", () => {
    const states = evaluateCapabilities({
      hasAuthenticatedSession: false,
      schemaAvailable: true,
    });
    const scorecard = states.find((s) => s.key === "scorecard");
    const dsl = states.find((s) => s.key === "naturalLanguageScreener");
    expect(scorecard?.available).toBe(true);
    expect(dsl?.available).toBe(true);
  });
});