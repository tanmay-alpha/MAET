import { describe, expect, it } from "bun:test";
import { parseCompanyScreenerParams } from "./company-query";

describe("company screener query parser", () => {
  it("accepts full-universe search, pagination, filters, buckets and safe sorting", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({
      q: "INE002A01018",
      page: "2",
      limit: "50",
      pe_max: "25",
      bucket_in: "large,mid",
      sortBy: "market_cap",
      sortDir: "desc",
    }));
    expect(input.q).toBe("INE002A01018");
    expect(input.page).toBe(2);
    expect(input.numbers.pe_max).toBe(25);
    expect(input.buckets).toEqual(["large", "mid"]);
    expect(input.sortDir).toBe("desc");
  });

  it("rejects untrusted sort columns", () => {
    expect(() => parseCompanyScreenerParams(new URLSearchParams({ sortBy: "drop table" }))).toThrow("Unsupported sortBy");
  });
});
