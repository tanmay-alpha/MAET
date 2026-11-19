import { describe, expect, it } from "bun:test";
import { nseFundamentalsSnapshotValues } from "./daily-processor";

describe("NSE fundamentals snapshot row", () => {
  const observed = {
    symbol: "RELIANCE",
    asOf: "2026-11-19T13:05:00.000Z",
    pe: 24.5,
    pb: 2.1,
    roe: 9.3,
    marketCap: 19_000_000_000_000,
    dividendYield: 0.4,
    sector: "Energy",
    raw: { pe: "24.5" },
  };

  it("is dated at the observation time, not labelled as a fiscal quarter", () => {
    const row = nseFundamentalsSnapshotValues(observed, "RELIANCE");
    expect(row.periodType).toBe("snapshot");
    expect(row.periodDate).toEqual(new Date("2026-11-19T13:05:00.000Z"));
  });

  it("never invents a filing or availability date the source does not provide", () => {
    const row = nseFundamentalsSnapshotValues(observed, "RELIANCE");
    expect(row.filingDate).toBeNull();
    expect(row.availableFrom).toBeNull();
  });

  it("keeps the source values and one row per company per month", () => {
    expect(nseFundamentalsSnapshotValues(observed, "RELIANCE")).toMatchObject({
      id: "RELIANCE-2026-11",
      companyId: "RELIANCE",
      peRatio: "24.5",
      pbRatio: "2.1",
      roe: "9.3",
      marketCap: "19000000000000",
      dividendYield: "0.4",
      source: "nse",
      raw: { pe: "24.5" },
    });
  });
});
