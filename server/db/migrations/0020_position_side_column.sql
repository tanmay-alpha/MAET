-- Migration 0020: Add side column to paper_positions for canonical short position direction.
--
-- Context:
--   The paper_positions.total_shares column stores absolute share counts (always positive).
--   Before this migration, position direction was inferred from context, but Math.abs()
--   was applied on write, making short positions indistinguishable from long positions
--   after a DB round-trip. This destroyed SHORT position direction on reload.
--
-- Fix:
--   Add a `side` TEXT column ('LONG' | 'SHORT') as the single authoritative direction field.
--   On every position write:  side = quantity >= 0 ? 'LONG' : 'SHORT'; total_shares = abs(quantity)
--   On every position read:   signedQuantity = side === 'SHORT' ? -total_shares : +total_shares
--
-- Migration Safety:
--   All existing rows receive side = 'LONG' (the safe default).
--   Any pre-migration SHORT positions would have been stored with a positive total_shares
--   and therefore CANNOT be safely distinguished from LONG positions without business data.
--   Decision: treat all existing rows as LONG. Admins must reset/review any accounts that
--   had active short positions before this migration. This is the only safe choice.
--
-- Constraint:
--   A CHECK constraint enforces only valid side values.

ALTER TABLE public.paper_positions
  ADD COLUMN IF NOT EXISTS side TEXT NOT NULL DEFAULT 'LONG';

ALTER TABLE public.paper_positions
  DROP CONSTRAINT IF EXISTS paper_positions_side_check;

ALTER TABLE public.paper_positions
  ADD CONSTRAINT paper_positions_side_check CHECK (side IN ('LONG', 'SHORT'));
