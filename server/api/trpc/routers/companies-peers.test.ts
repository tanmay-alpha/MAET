import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { companiesRouter } from "./companies";
import { db } from "../../../data/drizzle/client";
import { companies } from "../../../db/schema";
import { eq } from "drizzle-orm";

const caller = companiesRouter.createCaller({
  userId: "user-test",
  email: "test@example.com",
  role: "user",
});

const ROUTER_FIXTURE = {
  id: "00000000-0000-0000-0000-000000000099",
  symbol: "TEST_ROUTER_CO",
  name: "Router Test Co",
  exchange: "NSE",
  industry: "Router-Ind",
  sector: "Router-Sec",
  marketCap: "12345",
};

describe("companies.getPeerComparison tRPC procedure", () => {
  beforeAll(async () => {
    await db.delete(companies).where(eq(companies.symbol, "TEST_ROUTER_CO"));
    await db.insert(companies).values(ROUTER_FIXTURE);
  });

  afterAll(async () => {
    await db.delete(companies).where(eq(companies.symbol, "TEST_ROUTER_CO"));
  });

  it("rejects empty symbol with BAD_REQUEST", async () => {
    await expect(
      caller.getPeerComparison({ symbol: "" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects limit greater than 10 with BAD_REQUEST", async () => {
    await expect(
      caller.getPeerComparison({ symbol: "TEST_ROUTER_CO", limit: 20 })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("throws NOT_FOUND when company does not exist", async () => {
    await expect(
      caller.getPeerComparison({ symbol: "UNKNOWN999" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("normalizes lowercase and whitespace symbols", async () => {
    const res = await caller.getPeerComparison({ symbol: "  test_router_co  " });
    expect(res.target.symbol).toBe("TEST_ROUTER_CO");
    expect(res.selectionBasis).toBe("none");
    expect(res.target.marketCap).toBe(12345);
    expect(res.target.rank).toBe(1);
    expect(res.target.percentile).toBe(100);
  });
});
