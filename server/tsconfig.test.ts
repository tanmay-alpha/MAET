import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";

describe("tsconfig path aliases", () => {
  it("resolves @shared/types module to the shared workspace", async () => {
    const mod = await import("@shared/types/market");
    expect(mod).toBeDefined();
    expect(typeof mod.TickSchema).toBe("object");
  });
});
