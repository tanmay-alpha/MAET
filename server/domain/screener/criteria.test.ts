import { describe, it, expect } from "bun:test";
import { CriterionSchema } from "./criteria";

describe("CriterionSchema", () => {
  it("accepts a leaf criterion", () => {
    const c = { field: "pe", op: "lt", value: 30 };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("accepts an AND group", () => {
    const c = {
      op: "AND",
      children: [
        { field: "pe", op: "lt", value: 30 },
        { field: "rsi", op: "lt", value: 30, period: 14 },
      ],
    };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("accepts nested OR/AND", () => {
    const c = {
      op: "OR",
      children: [{ op: "AND", children: [{ field: "pe", op: "lt", value: 20 }] }],
    };
    expect(CriterionSchema.parse(c)).toEqual(c);
  });

  it("rejects unknown field", () => {
    expect(() => CriterionSchema.parse({ field: "bogus", op: "eq", value: 1 })).toThrow();
  });
});
