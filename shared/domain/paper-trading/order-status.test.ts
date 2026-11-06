import { describe, expect, it } from "bun:test";
import { WORKING_ORDER_STATUSES, isWorkingOrderStatus } from "./order-status";

describe("working order statuses", () => {
  it("treats every status that can still fill or be cancelled as working", () => {
    for (const status of ["PENDING", "TRIGGER_PENDING", "TRIGGERED", "PARTIALLY_FILLED"]) {
      expect(isWorkingOrderStatus(status)).toBe(true);
    }
    expect([...WORKING_ORDER_STATUSES].sort()).toEqual(["PARTIALLY_FILLED", "PENDING", "TRIGGERED", "TRIGGER_PENDING"]);
  });

  it("treats terminal and unknown statuses as not working", () => {
    for (const status of ["FILLED", "CANCELLED", "REJECTED", "pending", ""]) {
      expect(isWorkingOrderStatus(status)).toBe(false);
    }
  });
});
