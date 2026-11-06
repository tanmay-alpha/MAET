-- =============================================================================
-- Migration 0023b: stop-market bracket exits, per-generation idempotency keys,
--                  INITIAL_CASH backfill. Additive and idempotent.
-- =============================================================================

-- 1. Bracket stop-losses become stop-market orders: a stop-limit with limit = stop never
--    filled when the price gapped through the stop. The new value is not used in this file.
ALTER TYPE public.paper_order_type ADD VALUE IF NOT EXISTS 'STOP_LOSS_MARKET';

-- 2. Idempotency keys are scoped to the account generation: after a reset the same key
--    starts a new order instead of replaying one from the previous generation.
CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_user_generation_idempotency_key_unique
  ON public.paper_orders (user_id, generation, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
DROP INDEX IF EXISTS public.paper_orders_user_idempotency_key_unique;

-- 3. Accounts opened before INITIAL_CASH was written on account creation have no opening
--    ledger row, so their ledger does not sum to the cash balance. Backfill it for accounts
--    still in generation 1, where initial_cash is the opening balance. Accounts that were
--    reset already have per-generation INITIAL_CASH rows from the reset path, and their
--    generation-1 opening balance is not known, so it is not guessed.
INSERT INTO public.paper_ledger_entries
  (user_id, generation, fill_id, entry_type, amount, balance_after, currency,
   source_type, source_id, metadata, created_at)
SELECT
  a.user_id, 1, NULL, 'INITIAL_CASH', a.initial_cash, a.initial_cash, 'INR',
  'ACCOUNT_OPEN', 'open:1', jsonb_build_object('generation', 1, 'backfilled', true), a.created_at
FROM public.paper_accounts a
WHERE a.generation = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.paper_ledger_entries l
    WHERE l.user_id = a.user_id AND l.generation = 1 AND l.entry_type = 'INITIAL_CASH'
  )
ON CONFLICT DO NOTHING;
