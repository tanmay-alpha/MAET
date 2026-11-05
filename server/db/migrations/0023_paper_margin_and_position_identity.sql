-- =============================================================================
-- Migration 0023: paper order TRIGGERED status, position identity per generation,
--                 and a side/generation/exchange-aware calculate_live_margin.
-- Additive and idempotent; no data is rewritten or deleted.
-- =============================================================================

-- 1. 0005 created paper_order_status without 'TRIGGERED', but the application schema and
--    the order matcher use it for stop-limit orders whose stop has been hit. Any matcher query
--    mentioning it failed with "invalid input value for enum", so resting orders never filled.
ALTER TYPE public.paper_order_status ADD VALUE IF NOT EXISTS 'TRIGGERED' AFTER 'PENDING';

-- 2. Position identity is (user_id, generation, symbol, exchange) since 0011. The inline
--    UNIQUE (user_id, symbol, exchange) from 0005 was never dropped, so re-opening a symbol
--    after an account reset violated it. Its generated name is looked up, not assumed.
CREATE UNIQUE INDEX IF NOT EXISTS paper_positions_user_generation_symbol_exchange_unique
  ON public.paper_positions (user_id, generation, symbol, exchange);

DO $$
DECLARE
  legacy record;
BEGIN
  FOR legacy IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.paper_positions'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(c.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['exchange', 'symbol', 'user_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.paper_positions DROP CONSTRAINT %I', legacy.conname);
  END LOOP;
END $$;

-- 3. Breach detection used by the risk monitor. The 0006 version inferred direction from
--    total_shares > 0 (always true since 0020 stores absolute shares), summed positions from
--    abandoned generations, and looked prices up by bare symbol. Prices are now keyed
--    "EXCHANGE:SYMBOL"; positions without a price are marked at their entry price.
CREATE OR REPLACE FUNCTION public.calculate_live_margin(live_prices jsonb)
RETURNS TABLE (
  user_id uuid,
  cash_balance numeric,
  allocated_margin numeric,
  maintenance_margin numeric,
  total_upnl numeric,
  equity numeric,
  breached boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH marked AS (
    SELECT
      p.user_id,
      SUM(
        (CASE WHEN p.side = 'SHORT' THEN -1 ELSE 1 END)
        * p.total_shares
        * (
          COALESCE((live_prices ->> (p.exchange || ':' || p.symbol))::numeric, p.average_entry_price)
          - p.average_entry_price
        )
      ) AS total_unrealized_pnl
    FROM public.paper_positions p
    JOIN public.paper_accounts acct
      ON acct.user_id = p.user_id
     AND acct.generation = p.generation
    GROUP BY p.user_id
  )
  SELECT
    a.user_id,
    a.cash_balance::numeric,
    a.allocated_margin::numeric,
    a.maintenance_margin::numeric,
    COALESCE(m.total_unrealized_pnl, 0)::numeric,
    (a.cash_balance + COALESCE(m.total_unrealized_pnl, 0))::numeric,
    true
  FROM public.paper_accounts a
  LEFT JOIN marked m ON m.user_id = a.user_id
  WHERE a.status = 'ACTIVE'
    AND NOT COALESCE(a.is_locked, false)
    AND a.cash_balance + COALESCE(m.total_unrealized_pnl, 0) < a.maintenance_margin;
$$;
