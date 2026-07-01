import { describe, expect, it } from "bun:test";
import { appRouter } from "./index";

describe("tRPC authentication", () => {
  it("rejects protected procedures without a verified user", async () => {
    const caller = appRouter.createCaller({ userId: undefined, email: null });

    await expect(caller.market.getMarketClock()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows protected procedures with an authenticated context", async () => {
    const caller = appRouter.createCaller({ userId: "user-1", email: null });

    await expect(caller.market.getMarketClock()).resolves.toMatchObject({
      phase: expect.any(String),
    });
  });
});
