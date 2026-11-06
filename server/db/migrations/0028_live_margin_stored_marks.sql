-- =============================================================================
-- Migration 0028: calculate_live_margin marks a position without a live price at its last
--                 stored mark instead of its entry price.
-- Additive and idempotent: CREATE OR REPLACE of the same signature; no data is touched.
-- =============================================================================

-- The 0023 version used COALESCE(live price, average_entry_price), so a position with no
-- live tick (feed down, symbol not ticking yet) counted as break-even and could hide a loss
-- that was already known. Every fill stores its quote in last_quote_price/_timestamp; that
-- mark is never older than the entry price, so it is used before falling back to the entry
-- price, which only a legacy row with no stored mark still gets. A live price, when the
-- risk monitor has one, still wins: the stored mark is as old as the position's last fill.
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
          COALESCE(
            (live_prices ->> (p.exchange || ':' || p.symbol))::numeric,
            p.last_quote_price,
            p.average_entry_price
          )
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
