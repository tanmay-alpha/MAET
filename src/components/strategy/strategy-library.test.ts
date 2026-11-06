import { describe, expect, it } from "bun:test";
import { CreateStrategyInputSchema } from "@shared/strategy/contracts";
import { STRATEGY_TEMPLATES, templateCreateInput } from "./strategy-library";

// strategyDefinitions.create validates its input with this schema, strictly.
const CreateInput = CreateStrategyInputSchema.strict();

describe("strategy templates", () => {
  it.each(STRATEGY_TEMPLATES.map((t) => [t.id, t] as const))("%s creates a strategy the server accepts", (_id, template) => {
    const result = CreateInput.safeParse(templateCreateInput(template));
    expect(result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
  });

  it("names the definition after the template and keeps it runnable as a single long-only position", () => {
    for (const template of STRATEGY_TEMPLATES) {
      const { name, definition } = templateCreateInput(template);
      expect(definition.name).toBe(name);
      expect(definition.risk?.maximumOpenPositions).toBe(1);
      expect(definition.risk?.allowPyramiding).toBe(false);
    }
  });
});
