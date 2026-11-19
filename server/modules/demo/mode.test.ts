import { afterEach, describe, expect, it } from "bun:test";
import { capabilitiesRouter } from "../../api/trpc/routers/capabilities";
import { isDemoMode } from "./mode";

const original = process.env.MAET_DEMO_MODE;
afterEach(() => {
  if (original === undefined) delete process.env.MAET_DEMO_MODE;
  else process.env.MAET_DEMO_MODE = original;
});

const caller = capabilitiesRouter.createCaller({ email: null, role: "user" });

describe("demo mode", () => {
  it("is on only for MAET_DEMO_MODE=1 or true", () => {
    expect(isDemoMode({ MAET_DEMO_MODE: "1" })).toBe(true);
    expect(isDemoMode({ MAET_DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ MAET_DEMO_MODE: "0" })).toBe(false);
    expect(isDemoMode({ MAET_DEMO_MODE: "false" })).toBe(false);
  });

  it("is reported by capabilities.get", async () => {
    process.env.MAET_DEMO_MODE = "1";
    expect((await caller.get()).demoMode).toBe(true);
    delete process.env.MAET_DEMO_MODE;
    const standard = await caller.get();
    expect(standard.demoMode).toBe(false);
    expect(standard.capabilities.length).toBeGreaterThan(0);
  });
});
