import { describe, expect, it } from "bun:test";
import { parseNseIndexCsv } from "./nse-index-constituents";

describe("NSE index constituents", () => {
  it("parses quoted names and excludes non-EQ rows", () => {
    const csv = [
      "Company Name,Industry,Symbol,Series,ISIN Code",
      '"Alpha, Industries Limited",Capital Goods,ALPHA,EQ,INE000A01001',
      "Beta Limited,Services,BETA,BE,INE000B01001",
    ].join("\n");
    expect(parseNseIndexCsv(csv)).toEqual([{
      symbol: "ALPHA",
      name: "Alpha, Industries Limited",
      industry: "Capital Goods",
      isin: "INE000A01001",
    }]);
  });
});
