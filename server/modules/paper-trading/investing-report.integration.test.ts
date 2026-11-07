import { beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb, getSqlClient } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperPortfolioSnapshots } from "../../db/schema";
import { istDateKey } from "../../domain/market/clock";
import { createPaperTradingService } from "./service";
import { createPaperInvestingReportService, financialYearFor } from "./investing-report";
import { createPaperTradingRouter } from "../../api/trpc/routers/paper-trading";

async function user() {
  const id = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${id})`;
  await sql`INSERT INTO public.users (id,email) VALUES (${id},${`investing-${id}@example.com`})`;
  return id;
}
function trader(price: number) {
  return createPaperTradingService({
    database: getDb(), marketPhase: () => "OPEN",
    quoteLoader: async (exchange, symbol) => ({ exchange, symbol, price, volume: 100,
      ts: new Date().toISOString(), source: "angelone", quality: "live" }),
    // Synthetic test symbols are not in the symbol master.
    symbolExists: async () => true,
  });
}
const now = new Date();
const financialYearStart = financialYearFor(istDateKey(now));
function reports(price: number | null = null, asOf: Date = new Date()) {
  return createPaperInvestingReportService({ database: getDb(), now: () => asOf,
    loadPrice: async () => price === null ? null : ({ price, ts: asOf.toISOString(), source: "angelone", quality: "live" }),
  });
}

describe("Read-only paper investing reports", () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for investing report integration tests");
  });
  it("requires authentication for the read report procedure", async () => {
    const caller = createPaperTradingRouter(trader(1000), undefined, reports()).createCaller({ email: null, role: "user" });
    await expect(caller.investingReport()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("returns an uninitialised account without creating balances or snapshots", async () => {
    const id = await user();
    const report = await reports().getReport(id, { financialYearStart });
    expect(report.account).toBeNull();
    expect(await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId,id))).toHaveLength(0);
    expect(await getDb().select().from(paperPortfolioSnapshots).where(eq(paperPortfolioSnapshots.userId,id))).toHaveLength(0);
  });
  it("reconciles real fills, current equity and fees without mutating the account", async () => {
    const id = await user();
    const symbol = `INV${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    await trader(1000).placeOrder({ userId: id, command: { symbol,exchange:"NSE",side:"BUY",type:"MARKET",qty:10 } });
    await trader(1100).placeOrder({ userId: id, command: { symbol,exchange:"NSE",side:"SELL",type:"MARKET",qty:4 } });
    const start = new Date(now.getTime() - 365 * 86_400_000);
    await getDb().update(paperAccounts).set({ createdAt:start }).where(eq(paperAccounts.userId,id));
    const [before] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId,id));
    const fills = await getDb().select().from(paperFills).where(eq(paperFills.userId,id));
    const ledgerBefore = await getDb().select().from(paperLedgerEntries).where(eq(paperLedgerEntries.userId,id));
    const valuationTime = new Date();
    const report = await reports(1050, valuationTime).getReport(id,{ financialYearStart });
    const buy = fills.find(f => f.side === "BUY")!;
    const sell = fills.find(f => f.side === "SELL")!;
    const equity = Number(before!.cashBalance) + 6*(1050-Number(buy.fillPrice));
    expect(report.account?.equity).toBeCloseTo(equity,4);
    expect(report.valuationAsOf).toBe(valuationTime.toISOString());
    expect(report.portfolioXirr).toBeCloseTo(equity/Number(before!.initialCash)-1,8);
    expect(report.tax.intradayPnl).toBeCloseTo(4*(Number(sell.fillPrice)-Number(buy.fillPrice)),4);
    expect(report.tax.estimatedTax).toBe(0);
    expect(report.tax.grossStcg).toBe(0);
    expect(report.closedLots).toHaveLength(1);
    const [after] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId,id));
    expect(after).toEqual(before);
    expect(await getDb().select().from(paperLedgerEntries).where(eq(paperLedgerEntries.userId,id))).toEqual(ledgerBefore);
    expect(await getDb().select().from(paperPortfolioSnapshots).where(eq(paperPortfolioSnapshots.userId,id))).toHaveLength(0);
    expect((await reports(null,new Date(now.getTime()+86_400_000)).getReport(id,{financialYearStart})).stalePrices).toBe(true);
  });
  it("dates fills and the default FY in IST, so 00:15 IST on 1 Apr is the new FY", async () => {
    const id = await user();
    const symbol = `IST${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    // The quote freshness check reads the system clock, so the fill instants fake it too.
    async function fillAt(iso: string, side: "BUY" | "SELL", price: number) {
      setSystemTime(new Date(iso));
      try {
        await createPaperTradingService({
          database: getDb(), marketPhase: () => "OPEN",
          quoteLoader: async (exchange, quoted) => ({ exchange, symbol: quoted, price, volume: 100, ts: iso, source: "angelone", quality: "live" }),
          symbolExists: async () => true,
        }).placeOrder({ userId: id, command: { symbol,exchange:"NSE",side,type:"MARKET",qty:5 } });
      } finally {
        setSystemTime();
      }
    }
    await fillAt("2024-12-02T05:00:00.000Z", "BUY", 1000);
    // 18:45 UTC on 31 Mar is 00:15 IST on 1 Apr 2025: FY2025-26, never FY2024-25.
    await fillAt("2025-03-31T18:45:00.000Z", "SELL", 1100);
    const service = reports(null, new Date("2025-03-31T19:00:00.000Z"));
    const current = await service.getReport(id);
    expect(current.today).toBe("2025-04-01");
    expect(current.tax.financialYearStart).toBe(2025);
    expect(current.closedLots.map((lot) => [lot.entryDate, lot.exitDate, lot.kind])).toEqual([["2024-12-02", "2025-04-01", "delivery"]]);
    const sell = (await getDb().select().from(paperFills).where(eq(paperFills.userId,id))).find(f => f.side === "SELL")!;
    const buy = (await getDb().select().from(paperFills).where(eq(paperFills.userId,id))).find(f => f.side === "BUY")!;
    expect(current.tax.grossStcg).toBeCloseTo(5 * (Number(sell.fillPrice) - Number(buy.fillPrice)), 4);
    // Two dated flows, 120 IST days apart (2 Dec → 1 Apr), annualised on ACT/365.
    const growth = Number(sell.fillPrice) / Number(buy.fillPrice);
    expect(current.closedLots[0]!.xirr).toBeCloseTo(growth ** (365 / 120) - 1, 10);
    const previous = await service.getReport(id, { financialYearStart: 2024 });
    expect(previous.tax.matchedLots).toEqual([]);
    expect(previous.tax.grossStcg).toBe(0);
  });
  it("isolates another user and discards previous-generation fills after a reset", async () => {
    const id = await user();
    const symbol = `RST${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    const service = trader(1000);
    await service.placeOrder({userId:id,command:{symbol,exchange:"NSE",side:"BUY",type:"MARKET",qty:2}});
    await trader(1200).placeOrder({userId:id,command:{symbol,exchange:"NSE",side:"SELL",type:"MARKET",qty:2}});
    await service.resetAccount({userId:id,confirmation:true});
    const report = await reports().getReport(id,{financialYearStart});
    expect(report.account?.generation).toBe(2);
    expect(report.closedLots).toEqual([]);
    expect(report.tax.intradayPnl).toBe(0);
    expect(report.tax.grossStcg).toBe(0);
    expect(report.portfolioXirr).toBeNull();
    expect((await reports().getReport(await user(),{financialYearStart})).account).toBeNull();
  });
});
