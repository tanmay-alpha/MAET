import { describe, expect, it } from "bun:test";
import { reconcilePosition } from "./reconcile-position";

describe("Canonical Position Reconciliation Suite", () => {
  it("open long", () => {
    const res = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "BUY",
      fillQuantity: 10,
      fillPrice: 1000,
    });
    expect(res.action).toBe("OPEN");
    expect(res.resultingQuantity).toBe(10);
    expect(res.resultingAveragePrice).toBe(1000);
    expect(res.closedQuantity).toBe(0);
    expect(res.openedQuantity).toBe(10);
    expect(res.realisedPnl).toBe(0);
  });

  it("open short", () => {
    const res = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "SELL",
      fillQuantity: 10,
      fillPrice: 1000,
    });
    expect(res.action).toBe("OPEN");
    expect(res.resultingQuantity).toBe(-10);
    expect(res.resultingAveragePrice).toBe(1000);
    expect(res.closedQuantity).toBe(0);
    expect(res.openedQuantity).toBe(10);
    expect(res.realisedPnl).toBe(0);
  });

  it("increase long", () => {
    const res = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 10,
      fillPrice: 1200,
    });
    expect(res.action).toBe("INCREASE");
    expect(res.resultingQuantity).toBe(20);
    expect(res.resultingAveragePrice).toBe(1100);
    expect(res.closedQuantity).toBe(0);
    expect(res.openedQuantity).toBe(10);
    expect(res.realisedPnl).toBe(0);
  });

  it("increase short", () => {
    const res = reconcilePosition({
      existingQuantity: -10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 10,
      fillPrice: 1200,
    });
    expect(res.action).toBe("INCREASE");
    expect(res.resultingQuantity).toBe(-20);
    expect(res.resultingAveragePrice).toBe(1100);
    expect(res.closedQuantity).toBe(0);
    expect(res.openedQuantity).toBe(10);
    expect(res.realisedPnl).toBe(0);
  });

  it("reduce long", () => {
    const res = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 5,
      fillPrice: 1100,
    });
    expect(res.action).toBe("REDUCE");
    expect(res.resultingQuantity).toBe(5);
    expect(res.resultingAveragePrice).toBe(1000);
    expect(res.closedQuantity).toBe(5);
    expect(res.openedQuantity).toBe(0);
    expect(res.realisedPnl).toBe(500);
  });

  it("reduce short", () => {
    const res = reconcilePosition({
      existingQuantity: -10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 4,
      fillPrice: 900,
    });
    expect(res.action).toBe("REDUCE");
    expect(res.resultingQuantity).toBe(-6);
    expect(res.resultingAveragePrice).toBe(1000);
    expect(res.closedQuantity).toBe(4);
    expect(res.openedQuantity).toBe(0);
    expect(res.realisedPnl).toBe(400);
  });

  it("close long", () => {
    const res = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 10,
      fillPrice: 1100,
    });
    expect(res.action).toBe("CLOSE");
    expect(res.resultingQuantity).toBe(0);
    expect(res.resultingAveragePrice).toBe(0);
    expect(res.closedQuantity).toBe(10);
    expect(res.openedQuantity).toBe(0);
    expect(res.realisedPnl).toBe(1000);
  });

  it("close short", () => {
    const res = reconcilePosition({
      existingQuantity: -10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 10,
      fillPrice: 900,
    });
    expect(res.action).toBe("CLOSE");
    expect(res.resultingQuantity).toBe(0);
    expect(res.resultingAveragePrice).toBe(0);
    expect(res.closedQuantity).toBe(10);
    expect(res.openedQuantity).toBe(0);
    expect(res.realisedPnl).toBe(1000);
  });

  it("reverse long to short", () => {
    const res = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 15,
      fillPrice: 1100,
    });
    expect(res.action).toBe("REVERSE");
    expect(res.resultingQuantity).toBe(-5);
    expect(res.resultingAveragePrice).toBe(1100);
    expect(res.closedQuantity).toBe(10);
    expect(res.openedQuantity).toBe(5);
    expect(res.realisedPnl).toBe(1000);
  });

  it("reverse short to long", () => {
    const res = reconcilePosition({
      existingQuantity: -10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 15,
      fillPrice: 900,
    });
    expect(res.action).toBe("REVERSE");
    expect(res.resultingQuantity).toBe(5);
    expect(res.resultingAveragePrice).toBe(900);
    expect(res.closedQuantity).toBe(10);
    expect(res.openedQuantity).toBe(5);
    expect(res.realisedPnl).toBe(1000);
  });

  it("throws on invalid fill quantity", () => {
    expect(() =>
      reconcilePosition({
        existingQuantity: 0,
        existingAveragePrice: 0,
        side: "BUY",
        fillQuantity: 0,
        fillPrice: 1000,
      })
    ).toThrow();
  });

  it("throws on invalid fill price", () => {
    expect(() =>
      reconcilePosition({
        existingQuantity: 0,
        existingAveragePrice: 0,
        side: "BUY",
        fillQuantity: 10,
        fillPrice: -100,
      })
    ).toThrow();
  });

  it("throws on non-finite values", () => {
    expect(() =>
      reconcilePosition({
        existingQuantity: NaN,
        existingAveragePrice: 1000,
        side: "BUY",
        fillQuantity: 10,
        fillPrice: 1000,
      })
    ).toThrow();
  });
});
