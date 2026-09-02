import { describe, expect, test } from "bun:test";
import { ingestionRouter } from "./ingestion";

describe("ingestion options-chain trigger authorization", () => {
  test("requires the canonical admin role", async () => {
    const caller = ingestionRouter.createCaller({
      userId: "authenticated-user",
      email: null,
      role: "user",
    });

    await expect(caller.triggerOptionsChain({
      underlying: "NIFTY",
      expiry: "28AUG26",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("lets an admin role reach trigger input validation", async () => {
    const caller = ingestionRouter.createCaller({
      userId: "admin-user",
      email: null,
      role: "admin",
    });

    await expect(caller.triggerOptionsChain({
      underlying: "NIFTY",
      expiry: "invalid",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
