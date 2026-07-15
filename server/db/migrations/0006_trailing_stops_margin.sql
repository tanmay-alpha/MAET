-- =============================================================================
-- Migration 0006: trailing stops, account lockout, and live margin calculations
-- =============================================================================

-- 1. Add trailing stops columns to paper_orders
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS trailing_distance numeric(18, 4);
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS trailing_hwm numeric(18, 4);
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS trailing_lwm numeric(18, 4);
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS is_trailing_percent boolean DEFAULT false;

-- 2. Add lockout column to paper_accounts
ALTER TABLE paper_accounts ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

-- 3. Create or replace calculate_live_margin function
CREATE OR REPLACE FUNCTION calculate_live_margin(live_prices jsonb)
RETURNS TABLE (
  user_id uuid,
  cash_balance numeric,
  allocated_margin numeric,
  maintenance_margin numeric,
  total_upnl numeric,
  equity numeric,
  breached boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH user_upnl AS (
    SELECT
      p.user_id as pos_user_id,
      COALESCE(
        SUM(
          CASE
            WHEN p.total_shares > 0 THEN
              p.total_shares * (COALESCE((live_prices->>p.symbol)::numeric, p.average_entry_price) - p.average_entry_price)
            ELSE
              ABS(p.total_shares) * (p.average_entry_price - COALESCE((live_prices->>p.symbol)::numeric, p.average_entry_price))
          END
        ),
        0
      ) as total_unrealized_pnl
    FROM paper_positions p
    GROUP BY p.user_id
  )
  SELECT
    a.user_id,
    a.cash_balance::numeric,
    a.allocated_margin::numeric,
    a.maintenance_margin::numeric,
    COALESCE(u.total_unrealized_pnl, 0)::numeric as total_upnl,
    (a.cash_balance + COALESCE(u.total_unrealized_pnl, 0))::numeric as equity,
    ((a.cash_balance + COALESCE(u.total_unrealized_pnl, 0)) < a.maintenance_margin)::boolean as breached
  FROM paper_accounts a
  LEFT JOIN user_upnl u ON a.user_id = u.pos_user_id
  WHERE a.is_locked = false 
    AND ((a.cash_balance + COALESCE(u.total_unrealized_pnl, 0)) < a.maintenance_margin) = true;
END;
$$;
