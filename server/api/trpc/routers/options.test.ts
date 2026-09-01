import { describe, expect, it } from "bun:test";
import { optionsRouter } from "./options";

const caller = optionsRouter.createCaller({
  userId: "user-1",
  email: "user@example.com",
  role: "user",
});

describe("options router", () => {
  it("rejects empty underlyings before reading persisted expiries", async () => {
    await expect(caller.listExpiries({ underlying: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects impossible expiry dates before reading a chain", async () => {
    await expect(caller.getLatestChain({
      underlying: "NIFTY",
      expiryDate: "2026-02-29",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
