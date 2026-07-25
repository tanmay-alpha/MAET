-- =============================================================================
-- Migration 0011: Backend Paper Trading Consolidation — Phase 1
-- Project: MAET (Confirmed project_id: ztpbfmpfgmgmsitshzma)
-- Description: Expands paper trading tables for backend authority, adds
--              paper_fills, paper_ledger_entries, paper_outbox_events,
--              account status enum, idempotency keys, and locks down RLS.
-- =============================================================================

-- =============================================================================
-- 1. ENUMS
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_account_status') THEN
    CREATE TYPE paper_account_status AS ENUM ('ACTIVE', 'LIQUIDATION_PENDING', 'LIQUIDATED');
  END IF;
END $$;

-- =============================================================================
-- 2. EXPAND paper_accounts
-- =============================================================================

ALTER TABLE public.paper_accounts
  ADD COLUMN IF NOT EXISTS initial_cash numeric(18, 4) NOT NULL DEFAULT 1000000.0000,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric(18, 4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS status paper_account_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS liquidation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS last_equity numeric(18, 4),
  ADD COLUMN IF NOT EXISTS last_valued_at timestamptz,
  ADD COLUMN IF NOT EXISTS reset_at timestamptz;

-- Backfill status from is_locked for existing rows
UPDATE public.paper_accounts
SET status = CASE
  WHEN is_locked = true AND EXISTS (
    SELECT 1 FROM public.paper_positions p WHERE p.user_id = paper_accounts.user_id AND p.total_shares <> 0
  ) THEN 'LIQUIDATION_PENDING'::paper_account_status
  WHEN is_locked = true THEN 'LIQUIDATED'::paper_account_status
  ELSE 'ACTIVE'::paper_account_status
END
WHERE status = 'ACTIVE'::paper_account_status
  AND is_locked IS NOT NULL;

-- Initialize initial_cash from cash_balance if not yet set (accounts that were
-- created before this migration have their starting balance in cash_balance)
UPDATE public.paper_accounts
SET initial_cash = cash_balance
WHERE initial_cash = 1000000.0000
  AND cash_balance <> 1000000.0000
  AND cash_balance > 0;

-- =============================================================================
-- 3. EXPAND paper_orders
-- =============================================================================

ALTER TABLE public.paper_orders
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS client_order_id text,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_fill_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_source text,
  ADD COLUMN IF NOT EXISTS quote_quality text,
  ADD COLUMN IF NOT EXISTS quote_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS reference_price numeric(18, 4),
  ADD COLUMN IF NOT EXISTS last_quote_fingerprint text,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- Partial unique index: same user cannot reuse the same idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_user_idempotency_key_unique
  ON public.paper_orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS paper_orders_idempotency_key_idx
  ON public.paper_orders (idempotency_key);

-- =============================================================================
-- 4. EXPAND paper_positions
-- =============================================================================

ALTER TABLE public.paper_positions
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_quote_price numeric(18, 4),
  ADD COLUMN IF NOT EXISTS last_quote_source text,
  ADD COLUMN IF NOT EXISTS last_quote_quality text,
  ADD COLUMN IF NOT EXISTS last_quote_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- Ensure unique position identity includes generation
-- (the existing unique index on (user_id, symbol, exchange) stays for
--  generation=1; we add a covering index for all generations)
DROP INDEX IF EXISTS public.paper_positions_user_symbol_exchange_unique;
CREATE UNIQUE INDEX paper_positions_user_generation_symbol_exchange_unique
  ON public.paper_positions (user_id, generation, symbol, exchange);

-- Recreate the old index for backward compat during migration
CREATE UNIQUE INDEX paper_positions_user_symbol_exchange_gen1_unique
  ON public.paper_positions (user_id, symbol, exchange)
  WHERE generation = 1;

-- =============================================================================
-- 5. CREATE paper_fills
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.paper_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.paper_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,

  symbol text NOT NULL,
  exchange text NOT NULL DEFAULT 'NSE',
  side order_side NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),

  reference_price numeric(18, 4) NOT NULL,
  fill_price numeric(18, 4) NOT NULL,
  slippage numeric(18, 4) NOT NULL DEFAULT 0.0000,
  fees numeric(18, 4) NOT NULL DEFAULT 0.0000,
  realized_pnl numeric(18, 4) NOT NULL DEFAULT 0.0000,

  quote_source text NOT NULL,
  quote_quality text NOT NULL,
  quote_timestamp timestamptz NOT NULL,
  quote_fingerprint text NOT NULL,

  execution_reason text NOT NULL,
  execution_sequence integer NOT NULL,

  executed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paper_fills_order_sequence_unique UNIQUE (order_id, execution_sequence),
  CONSTRAINT paper_fills_order_fingerprint_unique UNIQUE (order_id, quote_fingerprint)
);

CREATE INDEX IF NOT EXISTS paper_fills_user_generation_executed_idx
  ON public.paper_fills (user_id, generation, executed_at DESC);
CREATE INDEX IF NOT EXISTS paper_fills_order_executed_idx
  ON public.paper_fills (order_id, executed_at);
CREATE INDEX IF NOT EXISTS paper_fills_user_generation_symbol_idx
  ON public.paper_fills (user_id, generation, symbol);

-- =============================================================================
-- 6. CREATE paper_ledger_entries
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.paper_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,

  fill_id uuid REFERENCES public.paper_fills(id) ON DELETE SET NULL,

  entry_type text NOT NULL,
  amount numeric(18, 4) NOT NULL,
  balance_after numeric(18, 4) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',

  source_type text NOT NULL,
  source_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paper_ledger_unique UNIQUE (user_id, generation, source_type, source_id, entry_type)
);

CREATE INDEX IF NOT EXISTS paper_ledger_user_generation_created_idx
  ON public.paper_ledger_entries (user_id, generation, created_at DESC);
CREATE INDEX IF NOT EXISTS paper_ledger_fill_id_idx
  ON public.paper_ledger_entries (fill_id);

-- =============================================================================
-- 7. CREATE paper_outbox_events
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.paper_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,

  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,

  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS paper_outbox_status_nextattempt_created_idx
  ON public.paper_outbox_events (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS paper_outbox_user_created_idx
  ON public.paper_outbox_events (user_id, created_at DESC);

-- =============================================================================
-- 8. RLS — Paper Trading Tables (backend-only access)
-- =============================================================================

-- paper_fills
ALTER TABLE IF EXISTS public.paper_fills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_fills_own_select ON public.paper_fills;
CREATE POLICY paper_fills_own_select
  ON public.paper_fills FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY paper_fills_service_role
  ON public.paper_fills FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- paper_ledger_entries
ALTER TABLE IF EXISTS public.paper_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_ledger_entries_own_select ON public.paper_ledger_entries;
CREATE POLICY paper_ledger_entries_own_select
  ON public.paper_ledger_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY paper_ledger_entries_service_role
  ON public.paper_ledger_entries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Revoke UPDATE and DELETE — fills and ledger are immutable
REVOKE UPDATE, DELETE ON public.paper_fills FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.paper_ledger_entries FROM authenticated, anon;

-- paper_outbox_events — NOT client accessible
ALTER TABLE IF EXISTS public.paper_outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_outbox_service_role ON public.paper_outbox_events;
CREATE POLICY paper_outbox_service_role
  ON public.paper_outbox_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- 9. RLS — Lock down existing paper tables (remove authenticated write)
-- =============================================================================

-- paper_accounts: authenticated can only SELECT (no INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS paper_accounts_own_insert ON public.paper_accounts;
DROP POLICY IF EXISTS paper_accounts_own_update ON public.paper_accounts;
DROP POLICY IF EXISTS paper_accounts_own_delete ON public.paper_accounts;
CREATE POLICY paper_accounts_own_select
  ON public.paper_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY paper_accounts_service_role
  ON public.paper_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON public.paper_accounts FROM authenticated;
REVOKE ALL ON public.paper_accounts FROM anon;

-- paper_orders: authenticated can only SELECT
DROP POLICY IF EXISTS paper_orders_own_insert ON public.paper_orders;
DROP POLICY IF EXISTS paper_orders_own_update ON public.paper_orders;
DROP POLICY IF EXISTS paper_orders_own_delete ON public.paper_orders;
CREATE POLICY paper_orders_own_select
  ON public.paper_orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY paper_orders_service_role
  ON public.paper_orders FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON public.paper_orders FROM authenticated;
REVOKE ALL ON public.paper_orders FROM anon;

-- paper_positions: authenticated can only SELECT
DROP POLICY IF EXISTS paper_positions_own_insert ON public.paper_positions;
DROP POLICY IF EXISTS paper_positions_own_update ON public.paper_positions;
DROP POLICY IF EXISTS paper_positions_own_delete ON public.paper_positions;
CREATE POLICY paper_positions_own_select
  ON public.paper_positions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY paper_positions_service_role
  ON public.paper_positions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON public.paper_positions FROM authenticated;
REVOKE ALL ON public.paper_positions FROM anon;

-- =============================================================================
-- 10. Update unique index on paper_positions to include generation
-- =============================================================================

-- The existing unique index from migration 0005 uses (user_id, symbol, exchange).
-- We add generation to the unique constraint to support account resets that
-- create a new generation with the same symbol positions.

-- The index paper_positions_user_generation_symbol_exchange_unique already
-- created above covers this. Drop the old gen-1-only index to avoid confusion.
DROP INDEX IF EXISTS public.paper_positions_user_symbol_exchange_gen1_unique;
