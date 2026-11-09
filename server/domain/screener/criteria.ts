// Re-export the canonical Criterion DSL from shared so domain code does not duplicate schemas.
// Per spec section 4, shared/types/* is the single source of truth for Zod schemas.
export {
  CriterionSchema,
  type Criterion,
  type CriterionField,
  type CriterionOp,
  type CriterionLeaf,
  type Screener,
} from "@shared/types/screener";