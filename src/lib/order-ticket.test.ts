import { describe, expect, test } from "bun:test";
import { buildTicketOrder, type OrderTicketInput } from "./order-ticket";

const base: OrderTicketInput = {
  symbol: "RELIANCE",
  exchange: "NSE",
  side: "BUY",
  type: "SL",
  quantity: 10,
  limitPrice: "",
  triggerPrice: "",
  marketPrice: 1300,
  stopLoss: "",
  takeProfit: "",
};

describe("buildTicketOrder", () => {
  test("stop-loss limit sends the trigger and limit separately", () => {
    expect(buildTicketOrder({ ...base, triggerPrice: "1310", limitPrice: "1312.5" })).toEqual({
      ok: true,
      order: {
        type: "STOP_LOSS_LIMIT",
        symbol: "RELIANCE",
        exchange: "NSE",
        side: "BUY",
        quantity: 10,
        stopPrice: 1310,
        limitPrice: 1312.5,
      },
    });
  });

  test("a buy stop must trigger at or below its limit", () => {
    expect(buildTicketOrder({ ...base, triggerPrice: "1315", limitPrice: "1312" }).ok).toBe(false);
    expect(buildTicketOrder({ ...base, triggerPrice: "1312", limitPrice: "1312" }).ok).toBe(true);
  });

  test("a sell stop must trigger at or above its limit", () => {
    const sell = { ...base, side: "SELL" as const };
    expect(buildTicketOrder({ ...sell, triggerPrice: "1280", limitPrice: "1285" }).ok).toBe(false);
    expect(buildTicketOrder({ ...sell, triggerPrice: "1285", limitPrice: "1280" })).toMatchObject({
      ok: true,
      order: { stopPrice: 1285, limitPrice: 1280 },
    });
  });

  test("stop-loss limit requires a trigger price", () => {
    expect(buildTicketOrder({ ...base, limitPrice: "1312" }).ok).toBe(false);
  });

  test("market orders carry optional bracket prices", () => {
    expect(buildTicketOrder({ ...base, type: "MKT", stopLoss: "1250", takeProfit: "" })).toEqual({
      ok: true,
      order: {
        type: "MARKET",
        symbol: "RELIANCE",
        exchange: "NSE",
        side: "BUY",
        quantity: 10,
        stopLossPrice: 1250,
        takeProfitPrice: undefined,
      },
    });
  });

  test("stop-loss limit orders ignore bracket fields left over from another order type", () => {
    expect(
      buildTicketOrder({ ...base, triggerPrice: "1310", limitPrice: "1312", stopLoss: "-5", takeProfit: "abc" })
    ).toMatchObject({ ok: true, order: { type: "STOP_LOSS_LIMIT", stopPrice: 1310, limitPrice: 1312 } });
  });

  test("market and limit orders still reject invalid bracket prices", () => {
    expect(buildTicketOrder({ ...base, type: "LMT", limitPrice: "1300", stopLoss: "-5" }).ok).toBe(false);
  });

  test("orders go to the selected exchange", () => {
    expect(buildTicketOrder({ ...base, exchange: "BSE", type: "MKT" })).toMatchObject({ ok: true, order: { exchange: "BSE" } });
    expect(buildTicketOrder({ ...base, exchange: "BSE", type: "LMT", limitPrice: "1300" })).toMatchObject({
      ok: true,
      order: { type: "LIMIT", exchange: "BSE", limitPrice: 1300 },
    });
  });
});
