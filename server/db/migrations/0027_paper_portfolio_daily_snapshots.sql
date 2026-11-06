-- Migration 0027: paper portfolio daily snapshots
--
-- paper_portfolio_snapshots (0008) was never written by any code path. It had
-- no account generation, no trading date and no uniqueness, so it could not
-- hold an idempotent end-of-day equity curve that restarts on an account
-- reset. Replace it with one row per (user, generation, IST trading date).
-- A legacy table that somehow holds rows is kept, renamed, instead of dropped.

DO $$
BEGIN
  IF to_regclass('public.paper_portfolio_snapshots') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'paper_portfolio_snapshots'
         AND column_name = 'snapshot_date'
     ) THEN
    -- Block concurrent writes so a row committed after the check cannot be dropped with the table.
    LOCK TABLE public.paper_portfolio_snapshots IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.paper_portfolio_snapshots) THEN
      ALTER TABLE public.paper_portfolio_snapshots RENAME TO paper_portfolio_snapshots_legacy_0008;
    ELSE
      DROP TABLE public.paper_portfolio_snapshots;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.paper_portfolio_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation              integer NOT NULL,
  -- IST calendar date of the NSE session this snapshot values.
  snapshot_date           date NOT NULL,
  initial_cash            numeric(18, 4) NOT NULL,
  cash_balance            numeric(18, 4) NOT NULL,
  -- Gross market value (|qty| x price) of open positions at the recorded prices.
  positions_market_value  numeric(18, 4) NOT NULL,
  -- cash + unrealised P&L (paper positions are margined; cash moves only by realised P&L and fees).
  equity                  numeric(18, 4) NOT NULL,
  realized_pnl            numeric(18, 4) NOT NULL,
  unrealized_pnl          numeric(18, 4) NOT NULL,
  fees_to_date            numeric(18, 4) NOT NULL,
  margin_used             numeric(18, 4) NOT NULL DEFAULT 0,
  positions_count         integer NOT NULL DEFAULT 0,
  -- True when any position was valued with a price not from the snapshot's session.
  stale_prices            boolean NOT NULL,
  -- Distinct price sources used, comma separated ('none' without positions).
  price_source            text NOT NULL,
  -- Per-position valuation: symbol, exchange, side, quantity, price, source, quality, asOf, stale.
  position_prices         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- False for an intraday (on-read) snapshot that the session close may still replace.
  is_final                boolean NOT NULL,
  captured_by             text NOT NULL,
  snapshot_time           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_portfolio_snapshots_generation_positive CHECK (generation > 0),
  CONSTRAINT paper_portfolio_snapshots_captured_by_valid CHECK (captured_by IN ('SCHEDULER', 'ON_READ')),
  CONSTRAINT paper_portfolio_snapshots_user_generation_date_unique UNIQUE (user_id, generation, snapshot_date)
);

-- Owners may read their rows through Supabase. No client role may write: the
-- backend writes as the table owner, which bypasses RLS.
ALTER TABLE public.paper_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_portfolio_snapshots_owner_select ON public.paper_portfolio_snapshots;
CREATE POLICY paper_portfolio_snapshots_owner_select ON public.paper_portfolio_snapshots
  FOR SELECT USING (user_id = auth.uid());
