import { describe, expect, it } from "bun:test";
import { parseNseCompanyCsv, searchNseCompanyMaster } from "./nse-company-master";

describe("NSE company master", () => {
  it("normalizes EQ companies and excludes non-EQ series", () => {
    const csv = [
      "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
      'ALPHA,"Alpha, Industries Limited",EQ,06-OCT-2008,5,1,INE000A01001,5',
      "BETA,Beta Limited,BE,03-MAY-1995,10,1,INE000B01001,10",
    ].join("\n");
    expect(parseNseCompanyCsv(csv)).toEqual([{
      symbol: "ALPHA",
      name: "Alpha, Industries Limited",
      exchange: "NSE",
      series: "EQ",
      isin: "INE000A01001",
      listingDate: "2008-10-06",
      paidUpValue: 5,
      marketLot: 1,
      faceValue: 5,
      source: "nse",
    }]);
  });

  it("ranks an exact symbol above company-name matches", () => {
    const companies = parseNseCompanyCsv([
      "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
      "RELCHEMQ,Reliance Chemotex Industries Limited,EQ,01-JAN-2000,10,1,INE000A01001,10",
      "RELIANCE,Reliance Industries Limited,EQ,01-JAN-2000,10,1,INE000B01001,10",
    ].join("\n"));
    expect(searchNseCompanyMaster(companies, "RELIANCE")[0]?.symbol).toBe("RELIANCE");
  });
});
