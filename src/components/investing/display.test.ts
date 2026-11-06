import { describe, expect, it } from "bun:test";
import { rupees, serverMarkLabel } from "./display";

describe("Portfolio monetary and valuation labels", () => {
  it("groups all rupee values consistently with two decimals", () => {
    expect(rupees(22365)).toBe("₹22,365.00");
    expect(rupees(5967)).toBe("₹5,967.00");
    expect(rupees(1005811.03)).toBe("₹10,05,811.03");
    expect(rupees(-125000.5)).toBe("₹-1,25,000.50");
  });
  it("identifies the oldest server mark with its IST date and time", () => {
    const label = serverMarkLabel("2026-11-07T00:00:00.000Z");
    expect(label).toContain("7 Nov 2026");
    expect(label).toContain("05:30:00");
    expect(label).toContain("IST");
    expect(label).toContain("oldest price");
  });
  it("does not invent a mark time for entry-price valuations", () => {
    expect(serverMarkLabel(null)).toBe("Server mark time unavailable (entry-price valuation).");
  });
});
