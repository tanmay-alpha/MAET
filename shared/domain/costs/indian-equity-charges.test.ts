import { describe, expect, it } from "bun:test";
import { computeIndianEquityCharges } from "./indian-equity-charges";

describe("computeIndianEquityCharges", () => {
  it("charges STT both sides but stamp duty only on the buy leg for NSE delivery", () => {
    const buy = computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "BUY", turnoverInr: 100_000 });
    const sell = computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "SELL", turnoverInr: 100_000 });

    expect(buy).toEqual({ brokerage: 0, stt: 100, exchangeTxn: 2.97, sebiFee: 0.1, stampDuty: 15, gst: 0.55, total: 118.62 });
    expect(sell).toEqual({ brokerage: 0, stt: 100, exchangeTxn: 2.97, sebiFee: 0.1, stampDuty: 0, gst: 0.55, total: 103.62 });
  });

  it("charges intraday STT on the sell leg only and the lower intraday stamp duty on the buy leg", () => {
    const buy = computeIndianEquityCharges({ exchange: "NSE", product: "INTRADAY", side: "BUY", turnoverInr: 100_000 });
    const sell = computeIndianEquityCharges({ exchange: "NSE", product: "INTRADAY", side: "SELL", turnoverInr: 100_000 });

    expect(buy.stt).toBe(0);
    expect(buy.stampDuty).toBe(3);
    expect(buy.total).toBe(6.62);
    expect(sell.stt).toBe(25);
    expect(sell.stampDuty).toBe(0);
    expect(sell.total).toBe(28.62);
  });

  it("applies 18% GST to brokerage, exchange and SEBI charges but not to STT or stamp duty", () => {
    const charges = computeIndianEquityCharges({
      exchange: "NSE",
      product: "DELIVERY",
      side: "BUY",
      turnoverInr: 100_000,
      brokerageInr: 20,
    });

    expect(charges.gst).toBe(4.15);
    expect(charges.total).toBe(142.22);
  });

  it("uses the BSE transaction rate for BSE trades", () => {
    const charges = computeIndianEquityCharges({ exchange: "BSE", product: "DELIVERY", side: "SELL", turnoverInr: 100_000 });

    expect(charges.exchangeTxn).toBe(3.75);
    expect(charges.gst).toBe(0.69);
  });

  it("returns zero charges for zero turnover and rejects invalid inputs", () => {
    expect(computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "BUY", turnoverInr: 0 }).total).toBe(0);
    expect(() => computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "BUY", turnoverInr: -1 })).toThrow(RangeError);
    expect(() => computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "BUY", turnoverInr: Number.NaN })).toThrow(RangeError);
    expect(() =>
      computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side: "BUY", turnoverInr: 1_000, brokerageInr: -5 }),
    ).toThrow(RangeError);
  });
});
