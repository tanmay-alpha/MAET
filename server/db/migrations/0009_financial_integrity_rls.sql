-- Phase 0: Financial Integrity Hardening — Supabase Row Level Security (RLS) Policies
-- Project: MAET (Confirmed project_id: ztpbfmpfgmgmsitshzma)
-- Description: Enables RLS across all application tables and defines explicit public SELECT, service_role write, and auth.uid() ownership policies.

-- ============================================================================
-- Helper Function to drop policy if exists cleanly
-- ============================================================================

DO $$
BEGIN
  -- 1. PUBLIC MARKET DATA TABLES
  -- Enable RLS and grant SELECT to anon/authenticated, ALL to service_role

  -- companies
  ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS companies_select_public ON public.companies;
  DROP POLICY IF EXISTS companies_service_role ON public.companies;
  CREATE POLICY companies_select_public ON public.companies FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY companies_service_role ON public.companies FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- fundamentals
  ALTER TABLE IF EXISTS public.fundamentals ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS fundamentals_select_public ON public.fundamentals;
  DROP POLICY IF EXISTS fundamentals_service_role ON public.fundamentals;
  CREATE POLICY fundamentals_select_public ON public.fundamentals FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY fundamentals_service_role ON public.fundamentals FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- company_identifiers
  ALTER TABLE IF EXISTS public.company_identifiers ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS company_identifiers_select_public ON public.company_identifiers;
  DROP POLICY IF EXISTS company_identifiers_service_role ON public.company_identifiers;
  CREATE POLICY company_identifiers_select_public ON public.company_identifiers FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY company_identifiers_service_role ON public.company_identifiers FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- financial_statements
  ALTER TABLE IF EXISTS public.financial_statements ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS financial_statements_select_public ON public.financial_statements;
  DROP POLICY IF EXISTS financial_statements_service_role ON public.financial_statements;
  CREATE POLICY financial_statements_select_public ON public.financial_statements FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY financial_statements_service_role ON public.financial_statements FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- price_daily
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_daily') THEN
    ALTER TABLE public.price_daily ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS price_daily_select_public ON public.price_daily;
    DROP POLICY IF EXISTS price_daily_service_role ON public.price_daily;
    CREATE POLICY price_daily_select_public ON public.price_daily FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY price_daily_service_role ON public.price_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- price_intraday
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_intraday') THEN
    ALTER TABLE public.price_intraday ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS price_intraday_select_public ON public.price_intraday;
    DROP POLICY IF EXISTS price_intraday_service_role ON public.price_intraday;
    CREATE POLICY price_intraday_select_public ON public.price_intraday FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY price_intraday_service_role ON public.price_intraday FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- candles
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'candles') THEN
    ALTER TABLE public.candles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS candles_select_public ON public.candles;
    DROP POLICY IF EXISTS candles_service_role ON public.candles;
    CREATE POLICY candles_select_public ON public.candles FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY candles_service_role ON public.candles FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- quote_snapshots
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quote_snapshots') THEN
    ALTER TABLE public.quote_snapshots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS quote_snapshots_select_public ON public.quote_snapshots;
    DROP POLICY IF EXISTS quote_snapshots_service_role ON public.quote_snapshots;
    CREATE POLICY quote_snapshots_select_public ON public.quote_snapshots FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY quote_snapshots_service_role ON public.quote_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- market_cap_classifications
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'market_cap_classifications') THEN
    ALTER TABLE public.market_cap_classifications ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS market_cap_classifications_select_public ON public.market_cap_classifications;
    DROP POLICY IF EXISTS market_cap_classifications_service_role ON public.market_cap_classifications;
    CREATE POLICY market_cap_classifications_select_public ON public.market_cap_classifications FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY market_cap_classifications_service_role ON public.market_cap_classifications FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- sectors
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sectors') THEN
    ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS sectors_select_public ON public.sectors;
    DROP POLICY IF EXISTS sectors_service_role ON public.sectors;
    CREATE POLICY sectors_select_public ON public.sectors FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY sectors_service_role ON public.sectors FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- peers
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'peers') THEN
    ALTER TABLE public.peers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS peers_select_public ON public.peers;
    DROP POLICY IF EXISTS peers_service_role ON public.peers;
    CREATE POLICY peers_select_public ON public.peers FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY peers_service_role ON public.peers FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- option_chain
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'option_chain') THEN
    ALTER TABLE public.option_chain ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS option_chain_select_public ON public.option_chain;
    DROP POLICY IF EXISTS option_chain_service_role ON public.option_chain;
    CREATE POLICY option_chain_select_public ON public.option_chain FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY option_chain_service_role ON public.option_chain FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- corporate_actions
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'corporate_actions') THEN
    ALTER TABLE public.corporate_actions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS corporate_actions_select_public ON public.corporate_actions;
    DROP POLICY IF EXISTS corporate_actions_service_role ON public.corporate_actions;
    CREATE POLICY corporate_actions_select_public ON public.corporate_actions FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY corporate_actions_service_role ON public.corporate_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- shareholding_patterns
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shareholding_patterns') THEN
    ALTER TABLE public.shareholding_patterns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS shareholding_patterns_select_public ON public.shareholding_patterns;
    DROP POLICY IF EXISTS shareholding_patterns_service_role ON public.shareholding_patterns;
    CREATE POLICY shareholding_patterns_select_public ON public.shareholding_patterns FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY shareholding_patterns_service_role ON public.shareholding_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- institutional_deals
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'institutional_deals') THEN
    ALTER TABLE public.institutional_deals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS institutional_deals_select_public ON public.institutional_deals;
    DROP POLICY IF EXISTS institutional_deals_service_role ON public.institutional_deals;
    CREATE POLICY institutional_deals_select_public ON public.institutional_deals FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY institutional_deals_service_role ON public.institutional_deals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- index_valuations
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'index_valuations') THEN
    ALTER TABLE public.index_valuations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS index_valuations_select_public ON public.index_valuations;
    DROP POLICY IF EXISTS index_valuations_service_role ON public.index_valuations;
    CREATE POLICY index_valuations_select_public ON public.index_valuations FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY index_valuations_service_role ON public.index_valuations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- market_baseline_metrics
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'market_baseline_metrics') THEN
    ALTER TABLE public.market_baseline_metrics ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS market_baseline_metrics_select_public ON public.market_baseline_metrics;
    DROP POLICY IF EXISTS market_baseline_metrics_service_role ON public.market_baseline_metrics;
    CREATE POLICY market_baseline_metrics_select_public ON public.market_baseline_metrics FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY market_baseline_metrics_service_role ON public.market_baseline_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- live_intraday_snapshots
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'live_intraday_snapshots') THEN
    ALTER TABLE public.live_intraday_snapshots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS live_intraday_snapshots_select_public ON public.live_intraday_snapshots;
    DROP POLICY IF EXISTS live_intraday_snapshots_service_role ON public.live_intraday_snapshots;
    CREATE POLICY live_intraday_snapshots_select_public ON public.live_intraday_snapshots FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY live_intraday_snapshots_service_role ON public.live_intraday_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- 2. INTERNAL INGESTION & OPERATIONAL TABLES
  -- Enable RLS, restrict anon & authenticated, allow service_role only

  -- ingestion_runs
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ingestion_runs') THEN
    ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ingestion_runs_service_role ON public.ingestion_runs;
    CREATE POLICY ingestion_runs_service_role ON public.ingestion_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- dead_letter_queue
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dead_letter_queue') THEN
    ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS dead_letter_queue_service_role ON public.dead_letter_queue;
    CREATE POLICY dead_letter_queue_service_role ON public.dead_letter_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- calculation_results
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calculation_results') THEN
    ALTER TABLE public.calculation_results ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS calculation_results_service_role ON public.calculation_results;
    CREATE POLICY calculation_results_service_role ON public.calculation_results FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- anomaly_flags
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'anomaly_flags') THEN
    ALTER TABLE public.anomaly_flags ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS anomaly_flags_service_role ON public.anomaly_flags;
    CREATE POLICY anomaly_flags_service_role ON public.anomaly_flags FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- source_audit
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'source_audit') THEN
    ALTER TABLE public.source_audit ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS source_audit_service_role ON public.source_audit;
    CREATE POLICY source_audit_service_role ON public.source_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- idempotency
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'idempotency') THEN
    ALTER TABLE public.idempotency ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS idempotency_service_role ON public.idempotency;
    CREATE POLICY idempotency_service_role ON public.idempotency FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- 3. USER-OWNED PAPER TRADING & ACCOUNT TABLES
  -- Enable RLS, restrict to authenticated users matching auth.uid() = user_id, allow service_role

  -- paper_accounts
  ALTER TABLE IF EXISTS public.paper_accounts ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_accounts_own_select ON public.paper_accounts;
  DROP POLICY IF EXISTS paper_accounts_own_insert ON public.paper_accounts;
  DROP POLICY IF EXISTS paper_accounts_own_update ON public.paper_accounts;
  DROP POLICY IF EXISTS paper_accounts_own_delete ON public.paper_accounts;
  DROP POLICY IF EXISTS paper_accounts_service_role ON public.paper_accounts;
  CREATE POLICY paper_accounts_own_select ON public.paper_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_accounts_own_insert ON public.paper_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_accounts_own_update ON public.paper_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_accounts_own_delete ON public.paper_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_accounts_service_role ON public.paper_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- paper_orders
  ALTER TABLE IF EXISTS public.paper_orders ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_orders_own_select ON public.paper_orders;
  DROP POLICY IF EXISTS paper_orders_own_insert ON public.paper_orders;
  DROP POLICY IF EXISTS paper_orders_own_update ON public.paper_orders;
  DROP POLICY IF EXISTS paper_orders_own_delete ON public.paper_orders;
  DROP POLICY IF EXISTS paper_orders_service_role ON public.paper_orders;
  CREATE POLICY paper_orders_own_select ON public.paper_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_orders_own_insert ON public.paper_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_orders_own_update ON public.paper_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_orders_own_delete ON public.paper_orders FOR DELETE TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_orders_service_role ON public.paper_orders FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- paper_positions
  ALTER TABLE IF EXISTS public.paper_positions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_positions_own_select ON public.paper_positions;
  DROP POLICY IF EXISTS paper_positions_own_insert ON public.paper_positions;
  DROP POLICY IF EXISTS paper_positions_own_update ON public.paper_positions;
  DROP POLICY IF EXISTS paper_positions_own_delete ON public.paper_positions;
  DROP POLICY IF EXISTS paper_positions_service_role ON public.paper_positions;
  CREATE POLICY paper_positions_own_select ON public.paper_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_positions_own_insert ON public.paper_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_positions_own_update ON public.paper_positions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  CREATE POLICY paper_positions_own_delete ON public.paper_positions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_positions_service_role ON public.paper_positions FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- paper_ledgers
  ALTER TABLE IF EXISTS public.paper_ledgers ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_ledgers_own_select ON public.paper_ledgers;
  DROP POLICY IF EXISTS paper_ledgers_service_role ON public.paper_ledgers;
  CREATE POLICY paper_ledgers_own_select ON public.paper_ledgers FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_ledgers_service_role ON public.paper_ledgers FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- paper_margin_logs
  ALTER TABLE IF EXISTS public.paper_margin_logs ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_margin_logs_own_select ON public.paper_margin_logs;
  DROP POLICY IF EXISTS paper_margin_logs_service_role ON public.paper_margin_logs;
  CREATE POLICY paper_margin_logs_own_select ON public.paper_margin_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_margin_logs_service_role ON public.paper_margin_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- paper_portfolio_snapshots
  ALTER TABLE IF EXISTS public.paper_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS paper_portfolio_snapshots_own_select ON public.paper_portfolio_snapshots;
  DROP POLICY IF EXISTS paper_portfolio_snapshots_service_role ON public.paper_portfolio_snapshots;
  CREATE POLICY paper_portfolio_snapshots_own_select ON public.paper_portfolio_snapshots FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY paper_portfolio_snapshots_service_role ON public.paper_portfolio_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- users
  ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS users_own_select ON public.users;
  DROP POLICY IF EXISTS users_service_role ON public.users;
  CREATE POLICY users_own_select ON public.users FOR SELECT TO authenticated USING (auth.uid()::text = id::text);
  CREATE POLICY users_service_role ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);

  -- watchlist
  ALTER TABLE IF EXISTS public.watchlist ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS watchlist_own_select ON public.watchlist;
  DROP POLICY IF EXISTS watchlist_own_insert ON public.watchlist;
  DROP POLICY IF EXISTS watchlist_own_delete ON public.watchlist;
  DROP POLICY IF EXISTS watchlist_service_role ON public.watchlist;
  CREATE POLICY watchlist_own_select ON public.watchlist FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);
  CREATE POLICY watchlist_own_insert ON public.watchlist FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id::text);
  CREATE POLICY watchlist_own_delete ON public.watchlist FOR DELETE TO authenticated USING (auth.uid()::text = user_id::text);
  CREATE POLICY watchlist_service_role ON public.watchlist FOR ALL TO service_role USING (true) WITH CHECK (true);

END $$;
