/**
 * Parameter sweeps over a strategy definition.
 *
 * A sweep parameter (shared SweepParameterSchema) names a numeric field of the definition by
 * dot-path, e.g. "entry.children.0.left.params.period", and lists the values to try.
 */

import type { z } from "zod";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { CreateSweepInputSchema } from "../../../shared/strategy/contracts";
import { FORBIDDEN_SWEEP_PATH_SEGMENTS, type SweepParameterSchema } from "../../../shared/strategy/schemas";

export type SweepParameter = z.infer<typeof SweepParameterSchema>;

/** Largest parameter grid a sweep or walk-forward run may request. */
export const MAX_SWEEP_COMBINATIONS = 500;

/** Size of the cartesian product of every parameter's values. */
export function countCombinations(parameters: readonly Pick<SweepParameter, "values">[]): number {
  return parameters.reduce((product, parameter) => product * parameter.values.length, 1);
}

/**
 * Cartesian product of every parameter's values (first parameter varies slowest). Throws, before
 * building anything, when the product exceeds `maxCombinations`.
 */
export function generateCombinations(parameters: SweepParameter[], maxCombinations: number): Record<string, number>[] {
  const count = countCombinations(parameters);
  if (count > maxCombinations) {
    throw new Error(`Too many parameter combinations: ${count} (max ${maxCombinations})`);
  }
  let combinations: Record<string, number>[] = [{}];
  for (const parameter of parameters) {
    combinations = combinations.flatMap((combo) => parameter.values.map((value) => ({ ...combo, [parameter.name]: value })));
  }
  return combinations;
}

/**
 * Re-validates parameters read back from a job row against the API's create-time rules (shape and
 * grid size); the row is not trusted to still hold what the API accepted.
 */
export function parseStoredSweepParameters(raw: unknown): SweepParameter[] {
  const parsed = CreateSweepInputSchema.shape.parameters.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid sweep parameters: ${parsed.error.message}`);
  const count = countCombinations(parsed.data);
  if (count > MAX_SWEEP_COMBINATIONS) {
    throw new Error(`Too many parameter combinations: ${count} (max ${MAX_SWEEP_COMBINATIONS})`);
  }
  return parsed.data;
}

/**
 * Returns a copy of `definition` with each parameter's value from `combo` written at its path.
 * Throws if a path does not resolve, through own properties only, to an existing number: a typo
 * must fail the run rather than silently optimise nothing, and a path must never reach a
 * prototype or an array's length.
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

    const invalid = () =>
      new Error(`Sweep parameter "${parameter.name}": path "${parameter.path}" is not a numeric field of the strategy`);
    const keys = parameter.path.split(".");
    if (keys.some((key) => FORBIDDEN_SWEEP_PATH_SEGMENTS.includes(key))) throw invalid();

    const field = keys.pop()!;
    let target: unknown = cloned;
    for (const key of keys) {
      if (target === null || typeof target !== "object" || !Object.hasOwn(target, key)) throw invalid();
      target = (target as Record<string, unknown>)[key];
    }
    if (
      target === null || typeof target !== "object" || Array.isArray(target)
      || !Object.hasOwn(target, field) || typeof (target as Record<string, unknown>)[field] !== "number"
    ) {
      throw invalid();
    }
    (target as Record<string, unknown>)[field] = value;
  }
  return cloned;
}
