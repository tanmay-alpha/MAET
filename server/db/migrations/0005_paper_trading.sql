-- =============================================================================
-- Migration 0005: paper trading execution tables and enums
-- =============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_order_type') THEN
        CREATE TYPE paper_order_type AS ENUM ('LIMIT', 'MARKET', 'STOP_LOSS_LIMIT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_order_status') THEN
        CREATE TYPE paper_order_status AS ENUM ('TRIGGER_PENDING', 'PENDING', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_execution_type') THEN
        CREATE TYPE paper_execution_type AS ENUM ('IMMEDIATE_OR_CANCEL', 'GOOD_TILL_CANCELLED');
    END IF;
END $$;

-- 1. Create paper_accounts table
CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cash_balance numeric(18, 4) NOT NULL DEFAULT 10000000.0000,
  allocated_margin numeric(18, 4) NOT NULL DEFAULT 0.0000,
  maintenance_margin numeric(18, 4) NOT NULL DEFAULT 0.0000,
  leverage_factor integer NOT NULL DEFAULT 5,
  liquidation_threshold numeric(10, 4) NOT NULL DEFAULT 0.1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create paper_orders table
CREATE TABLE IF NOT EXISTS paper_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_order_id uuid REFERENCES paper_orders(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  exchange text NOT NULL DEFAULT 'NSE',
  side order_side NOT NULL,
  type paper_order_type NOT NULL,
  status paper_order_status NOT NULL DEFAULT 'PENDING',
  execution_type paper_execution_type NOT NULL DEFAULT 'GOOD_TILL_CANCELLED',
  qty integer NOT NULL,
  limit_price numeric(18, 4),
  stop_price numeric(18, 4),
  stop_loss_price numeric(18, 4),
  take_profit_price numeric(18, 4),
  filled_qty integer NOT NULL DEFAULT 0,
  average_fill_price numeric(18, 4),
  slippage_applied numeric(18, 4) DEFAULT 0.0000,
  transaction_fee numeric(18, 4) DEFAULT 0.0000,
  placed_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_orders_user_idx ON paper_orders(user_id);
CREATE INDEX IF NOT EXISTS paper_orders_symbol_idx ON paper_orders(symbol);
CREATE INDEX IF NOT EXISTS paper_orders_parent_idx ON paper_orders(parent_order_id);
CREATE INDEX IF NOT EXISTS paper_orders_status_idx ON paper_orders(status);

-- 3. Create paper_positions table
CREATE TABLE IF NOT EXISTS paper_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  exchange text NOT NULL DEFAULT 'NSE',
  average_entry_price numeric(18, 4) NOT NULL,
  total_shares integer NOT NULL,
  realized_pnl numeric(18, 4) NOT NULL DEFAULT 0.0000,
  unrealized_pnl numeric(18, 4) NOT NULL DEFAULT 0.0000,
  margin_locked numeric(18, 4) NOT NULL DEFAULT 0.0000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, exchange)
);

CREATE INDEX IF NOT EXISTS paper_positions_user_idx ON paper_positions(user_id);
CREATE INDEX IF NOT EXISTS paper_positions_symbol_idx ON paper_positions(symbol);
