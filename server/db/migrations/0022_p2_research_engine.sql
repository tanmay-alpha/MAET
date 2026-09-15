-- Migration 0022: P2 Research Engine Database Extensions
-- Adds universe membership, corporate actions metadata, and point-in-time tracking.

CREATE TABLE IF NOT EXISTS public.universe_membership (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  universe TEXT NOT NULL,
  symbol TEXT NOT NULL,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'nse',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS universe_membership_uni_date_idx
  ON public.universe_membership(universe, valid_from, valid_to);

CREATE INDEX IF NOT EXISTS universe_membership_symbol_idx
  ON public.universe_membership(symbol);

-- Expand corporate_actions table with audit metadata if not present
ALTER TABLE public.corporate_actions
  ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'nse',
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Expand fundamentals table with point-in-time revision columns if not present
ALTER TABLE public.fundamentals
  ADD COLUMN IF NOT EXISTS filing_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS fundamentals_company_pit_idx
  ON public.fundamentals(company_id, available_from, revision);

-- Expand strategy_backtest_jobs table with execution model, reproducibility metadata, and warnings
ALTER TABLE public.strategy_backtest_jobs
  ADD COLUMN IF NOT EXISTS execution_model_config JSONB,
  ADD COLUMN IF NOT EXISTS reproducibility_metadata JSONB,
  ADD COLUMN IF NOT EXISTS warnings JSONB;

-- Expand strategy_walk_forward_windows table with out-of-sample test window tracking
ALTER TABLE public.strategy_walk_forward_windows
  ADD COLUMN IF NOT EXISTS test_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_to TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_metrics JSONB;

