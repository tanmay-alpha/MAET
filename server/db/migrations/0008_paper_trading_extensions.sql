-- Migration: 0008_paper_trading_extensions.sql
-- Description: Create paper_ledgers, paper_margin_logs, and paper_portfolio_snapshots tables for advanced portfolio tracking and margin auditing.

CREATE TABLE IF NOT EXISTS public.paper_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount NUMERIC(18, 4) NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_ledgers_user_idx ON public.paper_ledgers(user_id);
CREATE INDEX IF NOT EXISTS paper_ledgers_type_idx ON public.paper_ledgers(type);
CREATE INDEX IF NOT EXISTS paper_ledgers_created_idx ON public.paper_ledgers(created_at);

CREATE TABLE IF NOT EXISTS public.paper_margin_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    allocated_margin NUMERIC(18, 4) NOT NULL,
    maintenance_margin NUMERIC(18, 4) NOT NULL,
    leverage_applied INTEGER NOT NULL DEFAULT 5,
    log_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_margin_logs_user_idx ON public.paper_margin_logs(user_id);
CREATE INDEX IF NOT EXISTS paper_margin_logs_created_idx ON public.paper_margin_logs(created_at);

CREATE TABLE IF NOT EXISTS public.paper_portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    cash_balance NUMERIC(18, 4) NOT NULL,
    equity NUMERIC(18, 4) NOT NULL,
    margin_used NUMERIC(18, 4) NOT NULL,
    unrealized_pnl NUMERIC(18, 4) NOT NULL,
    realized_pnl NUMERIC(18, 4) NOT NULL,
    snapshot_time TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_portfolio_snapshots_user_idx ON public.paper_portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS paper_portfolio_snapshots_time_idx ON public.paper_portfolio_snapshots(snapshot_time);
