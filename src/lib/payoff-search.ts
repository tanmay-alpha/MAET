/**
 * Payoff Lab URL search: the route's `validateSearch` lives in the route tree that every page
 * loads, so it is kept apart from the lab's draft/validation state (`payoff-lab-state.ts`).
 */
import { z } from "zod";

export const MAX_LEGS = 12;
export const IV_SHIFT_LIMIT = 10;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real YYYY-MM-DD day: engines disagree on "2026-02-30" (rolled into March, or NaN). */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const payoffSearchSchema = z.object({
  sym: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9&.-]{1,20}$/)
    .optional()
    .catch(undefined),
  spot: z.coerce.number().finite().positive().optional().catch(undefined),
  lot: z.coerce.number().int().positive().optional().catch(undefined),
  step: z.coerce.number().finite().positive().optional().catch(undefined),
  exp: z.string().refine(isCalendarDate).optional().catch(undefined),
  r: z.coerce.number().min(0).max(50).optional().catch(undefined),
  iv: z.coerce.number().positive().max(300).optional().catch(undefined),
  legs: z.string().max(MAX_LEGS * 48).optional().catch(undefined),
  ivs: z.coerce.number().min(-IV_SHIFT_LIMIT).max(IV_SHIFT_LIMIT).optional().catch(undefined),
});

export type PayoffSearch = z.infer<typeof payoffSearchSchema>;

/** The route's search schema: invalid values are dropped, never thrown. */
export function parsePayoffSearch(search: Record<string, unknown>): PayoffSearch {
  return payoffSearchSchema.parse(search);
}
