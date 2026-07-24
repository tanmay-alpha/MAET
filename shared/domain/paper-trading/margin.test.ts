import { describe, expect, it } from "bun:test";
import { reconcilePosition } from "./reconcile-position";
import { calculateIncrementalMarginFromReconciliation } from "./margin";

describe("Canonical Margin derived from Reconciliation Suite", () => {
  it("open position requires full margin", () => {
    const recon = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "BUY",
      fillQuantity: 10,
      fillPrice: 1000,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1000, 5);
    expect(incMargin).toBe(2000); // (10 * 1000) / 5
  });

  it("increase requires added margin only", () => {
    const recon = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 5,
      fillPrice: 1000,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1000, 5);
    expect(incMargin).toBe(1000); // (5 * 1000) / 5
  });

  it("reduction requires zero", () => {
    const recon = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 5,
      fillPrice: 1100,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1100, 5);
    expect(incMargin).toBe(0);
  });

  it("close requires zero", () => {
    const recon = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 10,
      fillPrice: 1100,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1100, 5);
    expect(incMargin).toBe(0);
  });

  it("reversal requires remainder margin only", () => {
    const recon = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 15,
      fillPrice: 1100,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1100, 5);
    expect(incMargin).toBe(1100); // (5 * 1100) / 5
  });

  it("huge second same-direction order has large incremental margin requirement", () => {
    const recon = reconcilePosition({
      existingQuantity: 10,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 10000,
      fillPrice: 1000,
    });
    const incMargin = calculateIncrementalMarginFromReconciliation(recon, 1000, 5);
    expect(incMargin).toBe(2000000); // (10000 * 1000) / 5
  });
});
