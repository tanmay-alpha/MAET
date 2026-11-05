/**
 * Parameter sweeps over a strategy definition.
 *
 * A sweep parameter (shared SweepParameterSchema) names a numeric field of the definition by
 * dot-path, e.g. "entry.children.0.left.params.period", and lists the values to try.
 */

import type { z } from "zod";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import type { SweepParameterSchema } from "../../../shared/strategy/schemas";

export type SweepParameter = z.infer<typeof SweepParameterSchema>;

/** Cartesian product of every parameter's values (first parameter varies slowest), capped. */
export function generateCombinations(parameters: SweepParameter[], maxCombinations: number): Record<string, number>[] {
  let combinations: Record<string, number>[] = [{}];
  for (const parameter of parameters) {
    combinations = combinations.flatMap((combo) => parameter.values.map((value) => ({ ...combo, [parameter.name]: value })));
  }
  return combinations.slice(0, maxCombinations);
}

/**
 * Returns a copy of `definition` with each parameter's value from `combo` written at its path.
 * Throws if a path does not resolve to an existing number: a typo must fail the run rather than
 * silently optimise nothing.
 */
export function applyParameters(
  definition: StrategyDefinition,
  parameters: SweepParameter[],
  combo: Record<string, number>,
): StrategyDefinition {
  const cloned: StrategyDefinition = structuredClone(definition);
  for (const parameter of parameters) {
    const value = combo[parameter.name];
    if (value === undefined) continue;

    const keys = parameter.path.split(".");
    const field = keys.pop()!;
    let target: unknown = cloned;
    for (const key of keys) {
      target = target !== null && typeof target === "object" ? (target as Record<string, unknown>)[key] : undefined;
    }
    if (target === null || typeof target !== "object" || typeof (target as Record<string, unknown>)[field] !== "number") {
      throw new Error(`Sweep parameter "${parameter.name}": path "${parameter.path}" is not a numeric field of the strategy`);
    }
    (target as Record<string, unknown>)[field] = value;
  }
  return cloned;
}
