import { describe, expect, it } from "bun:test";
import type { CorporateActionEvent } from "@shared/types";
import { CORPORATE_ACTION_TTL_MS, createCorporateActionService } from "./corporate-action-service";

const DIVIDEND: CorporateActionEvent = {
  kind: "dividend",
  exDate: "2025-08-14",
  amount: 5.5,
  currency: "INR",
  splitAdjusted: false,
};
const SPLIT: CorporateActionEvent = { kind: "split", exDate: "2024-10-28", numerator: 2, denominator: 1 };

function harness(responses: Array<CorporateActionEvent[] | Error>) {
  const clock = { now: Date.parse("2026-11-06T10:00:00.000Z") };
  const tickers: string[] = [];
  const service = createCorporateActionService({
    now: () => clock.now,
    fetchEvents: async (ticker) => {
      tickers.push(ticker);
      const next = responses.shift();
      if (!next) throw new Error("no scripted response");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { clock, tickers, service };
}

describe("corporate action service", () => {
  it("reads the provider once per symbol within 24 hours", async () => {
    const { clock, tickers, service } = harness([[DIVIDEND]]);

    const first = await service.load("reliance");
    clock.now += CORPORATE_ACTION_TTL_MS - 1;
    const second = await service.load("RELIANCE");

    expect(tickers).toEqual(["RELIANCE.NS"]);
    expect(second).toBe(first);
    expect(first).toEqual({
      symbol: "RELIANCE",
      source: "yahoo",
      asOf: "2026-11-06T10:00:00.000Z",
      stale: false,
      events: [DIVIDEND],
    });
  });

  it("refreshes after 24 hours", async () => {
    const { clock, tickers, service } = harness([[DIVIDEND], [DIVIDEND, SPLIT]]);

    await service.load("RELIANCE");
    clock.now += CORPORATE_ACTION_TTL_MS;
    const refreshed = await service.load("RELIANCE");

    expect(tickers).toHaveLength(2);
    expect(refreshed.events).toEqual([DIVIDEND, SPLIT]);
    expect(refreshed.asOf).toBe(new Date(clock.now).toISOString());
  });

  it("serves the last good copy marked stale when a refresh fails", async () => {
    const { clock, service } = harness([[DIVIDEND, SPLIT], new Error("yahoo candles 429")]);

    const fresh = await service.load("RELIANCE");
    clock.now += CORPORATE_ACTION_TTL_MS + 1;
    const stale = await service.load("RELIANCE");

    expect(stale).toEqual({ ...fresh, stale: true });
    expect(stale.asOf).toBe(fresh.asOf);
  });

  it("retries the provider after a stale answer instead of caching the failure", async () => {
    const { clock, tickers, service } = harness([[DIVIDEND], new Error("down"), [DIVIDEND, SPLIT]]);

    await service.load("RELIANCE");
    clock.now += CORPORATE_ACTION_TTL_MS;
    expect((await service.load("RELIANCE")).stale).toBe(true);
    const recovered = await service.load("RELIANCE");

    expect(tickers).toHaveLength(3);
    expect(recovered.stale).toBe(false);
    expect(recovered.events).toEqual([DIVIDEND, SPLIT]);
  });

  it("propagates the error when nothing was ever cached", async () => {
    const { service } = harness([new Error("yahoo: empty result")]);
    await expect(service.load("RELIANCE")).rejects.toThrow("yahoo: empty result");
  });

  it("shares one provider read between concurrent requests", async () => {
    const { tickers, service } = harness([[SPLIT]]);
    const [a, b] = await Promise.all([service.load("RELIANCE"), service.load("RELIANCE")]);
    expect(tickers).toHaveLength(1);
    expect(a).toBe(b);
  });
});
