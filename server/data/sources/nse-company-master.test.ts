import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  COMPANY_MASTER_FAILURE_BACKOFF_MS,
  COMPANY_MASTER_FORCE_MIN_AGE_MS,
  getNseCompanyMaster,
  parseNseCompanyCsv,
  resetCompanyMasterCacheForTests,
  searchNseCompanyMaster,
} from "./nse-company-master";

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

const NSE_HOST = "nsearchives.nseindia.com";
const realFetch = globalThis.fetch;
const realVercel = process.env.VERCEL;

function equityCsv(count: number): string {
  const header = "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";
  const rows = Array.from({ length: count }, (_, i) => `SYM${i},Company ${i} Limited,EQ,01-JAN-2000,10,1,INE${String(i).padStart(6, "0")}01,10`);
  return [header, ...rows].join("\n");
}

/** Stubs fetch; NSE answers with `nse()` after `gate` resolves, every other host fails. */
function stubFetch(nse: () => Response, gate: Promise<void> = Promise.resolve()) {
  const calls = { nse: 0, other: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.host !== NSE_HOST) {
      calls.other++;
      return new Response("unavailable", { status: 503 });
    }
    calls.nse++;
    await gate;
    return nse();
  }) as typeof fetch;
  return calls;
}

describe("getNseCompanyMaster single flight", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = realVercel;
    setSystemTime();
    resetCompanyMasterCacheForTests();
  });

  it("shares one NSE fetch between concurrent callers and backs off after it fails", async () => {
    resetCompanyMasterCacheForTests();
    const gate = Promise.withResolvers<void>();
    const calls = stubFetch(() => new Response("blocked", { status: 403 }), gate.promise);

    const concurrent = Array.from({ length: 10 }, (_, i) => getNseCompanyMaster(i % 2 === 0));
    gate.resolve();
    const settled = await Promise.allSettled(concurrent);

    expect(calls.nse).toBe(1);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);
    // Inside the backoff window nobody refetches, forced or not.
    await expect(getNseCompanyMaster()).rejects.toThrow("HTTP 403");
    await expect(getNseCompanyMaster(true)).rejects.toThrow("HTTP 403");
    expect(calls.nse).toBe(1);
  });

  it("retries after the backoff and then serves the cache, even to forced callers inside the minimum age", async () => {
    resetCompanyMasterCacheForTests();
    const start = new Date("2026-11-10T04:00:00.000Z");
    setSystemTime(start);
    let healthy = false;
    const calls = stubFetch(() => (healthy ? new Response(equityCsv(1_200)) : new Response("down", { status: 500 })));

    await expect(getNseCompanyMaster()).rejects.toThrow("HTTP 500");
    healthy = true;
    setSystemTime(new Date(start.getTime() + COMPANY_MASTER_FAILURE_BACKOFF_MS - 1));
    await expect(getNseCompanyMaster()).rejects.toThrow("HTTP 500");
    expect(calls.nse).toBe(1);

    setSystemTime(new Date(start.getTime() + COMPANY_MASTER_FAILURE_BACKOFF_MS));
    const loaded = await Promise.all(Array.from({ length: 5 }, () => getNseCompanyMaster()));
    expect(loaded.every((entries) => entries.length === 1_200)).toBe(true);
    expect(calls.nse).toBe(2);

    // refresh=1 is public: within the minimum age it must not reach NSE.
    await getNseCompanyMaster(true);
    expect(calls.nse).toBe(2);
    setSystemTime(new Date(start.getTime() + COMPANY_MASTER_FAILURE_BACKOFF_MS + COMPANY_MASTER_FORCE_MIN_AGE_MS));
    await getNseCompanyMaster(true);
    expect(calls.nse).toBe(3);
  });

  it("serves the stale list while NSE keeps failing past the cache lifetime", async () => {
    resetCompanyMasterCacheForTests();
    process.env.VERCEL = "1";
    const start = new Date("2026-11-10T04:00:00.000Z");
    setSystemTime(start);
    let healthy = true;
    const calls = stubFetch(() => (healthy ? new Response(equityCsv(1_100)) : new Response("down", { status: 502 })));
    expect(await getNseCompanyMaster()).toHaveLength(1_100);

    healthy = false;
    const afterTtl = start.getTime() + 6 * 60 * 60 * 1000;
    setSystemTime(new Date(afterTtl));
    const stale = await Promise.all(Array.from({ length: 10 }, () => getNseCompanyMaster()));
    expect(stale.every((entries) => entries.length === 1_100)).toBe(true);
    expect(calls.nse).toBe(2);

    setSystemTime(new Date(afterTtl + COMPANY_MASTER_FAILURE_BACKOFF_MS - 1));
    expect(await getNseCompanyMaster()).toHaveLength(1_100);
    expect(calls.nse).toBe(2);
    expect(calls.other).toBe(0);
  });
});
