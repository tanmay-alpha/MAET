import { describe, it, expect } from "bun:test";
import { normalize, isStale } from "./tick";
import { TickSchema } from "@shared/types";

describe("tick normalization", () => {
  it("normalizes an Angel One raw payload", () => {
    const raw = {
      last_traded_price: 2500.5,
      volume_traded_for_the_day: 12345,
      exchange_timestamp: "2026-06-19T03:45:00.000Z",
      best_bid_price: 2500.0,
      best_ask_price: 2501.0,
    };
    const t = normalize(raw, "NSE", "RELIANCE");
    expect(() => TickSchema.parse(t)).not.toThrow();
    expect(t.price).toBe(2500.5);
    expect(t.bid).toBe(2500.0);
    expect(t.ask).toBe(2501.0);
    expect(t.source).toBe("angelone");
  });

  it("rejects a negative price", () => {
    expect(() => normalize({ last_traded_price: -1, volume_traded_for_the_day: 0, exchange_timestamp: new Date().toISOString() }, "NSE", "X")).toThrow();
  });
});

describe("tick staleness", () => {
  it("is false for a fresh tick", () => {
    const t = normalize({ last_traded_price: 1, volume_traded_for_the_day: 1, exchange_timestamp: new Date().toISOString() }, "NSE", "X");
    expect(isStale(t, new Date(), 5_000)).toBe(false);
  });

  it("is true for a tick older than maxAge", () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const t = normalize({ last_traded_price: 1, volume_traded_for_the_day: 1, exchange_timestamp: old }, "NSE", "X");
    expect(isStale(t, new Date(), 5_000)).toBe(true);
  });
});
