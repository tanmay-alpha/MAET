-- Phase 0.1: Financial Integrity Remediation — Remove Legacy Permissive RLS Policies
-- Project: MAET (Confirmed project_id: ztpbfmpfgmgmsitshzma)
-- Description: Drops legacy permissive and duplicate policies, revokes table write privileges from anon/authenticated on public market tables, and ensures fail-closed RLS access.

DO $$
BEGIN
  -- 1. DROP LEGACY DUPLICATE / UNSTRUCTURED POLICIES
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_daily') THEN
    DROP POLICY IF EXISTS "service write price_daily" ON public.price_daily;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_intraday') THEN
    DROP POLICY IF EXISTS "service write price_intraday" ON public.price_intraday;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sectors') THEN
    DROP POLICY IF EXISTS "service write sectors" ON public.sectors;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'peers') THEN
    DROP POLICY IF EXISTS "service write peers" ON public.peers;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ingestion_runs') THEN
    DROP POLICY IF EXISTS "service write ingestion_runs" ON public.ingestion_runs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dead_letter_queue') THEN
    DROP POLICY IF EXISTS "service write dead_letter_queue" ON public.dead_letter_queue;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calculation_results') THEN
    DROP POLICY IF EXISTS "service write calculation_results" ON public.calculation_results;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies') THEN
    DROP POLICY IF EXISTS "public company master read" ON public.companies;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_identifiers') THEN
    DROP POLICY IF EXISTS "public company identifiers read" ON public.company_identifiers;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'financial_statements') THEN
    DROP POLICY IF EXISTS "public financial statements read" ON public.financial_statements;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fundamentals') THEN
    DROP POLICY IF EXISTS "public fundamentals read" ON public.fundamentals;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'market_cap_classifications') THEN
    DROP POLICY IF EXISTS "public market cap classifications read" ON public.market_cap_classifications;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quote_snapshots') THEN
    DROP POLICY IF EXISTS "public quote snapshots read" ON public.quote_snapshots;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backtest_runs') THEN
    DROP POLICY IF EXISTS "backtest runs own rows" ON public.backtest_runs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'brokers') THEN
    DROP POLICY IF EXISTS "brokers own rows" ON public.brokers;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    DROP POLICY IF EXISTS "orders own rows" ON public.orders;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'screener_runs') THEN
    DROP POLICY IF EXISTS "screener runs own rows" ON public.screener_runs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
    DROP POLICY IF EXISTS "users read own row" ON public.users;
    DROP POLICY IF EXISTS "users update own row" ON public.users;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'watchlist') THEN
    DROP POLICY IF EXISTS "watchlist own rows" ON public.watchlist;
  END IF;

  -- 2. REVOKE DIRECT TABLE WRITE PERMISSIONS FROM ANON & AUTHENTICATED ON MARKET TABLES
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.companies FROM anon, authenticated;
    GRANT SELECT ON public.companies TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fundamentals') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fundamentals FROM anon, authenticated;
    GRANT SELECT ON public.fundamentals TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_identifiers') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.company_identifiers FROM anon, authenticated;
    GRANT SELECT ON public.company_identifiers TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'financial_statements') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.financial_statements FROM anon, authenticated;
    GRANT SELECT ON public.financial_statements TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_daily') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_daily FROM anon, authenticated;
    GRANT SELECT ON public.price_daily TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'price_intraday') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_intraday FROM anon, authenticated;
    GRANT SELECT ON public.price_intraday TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'candles') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.candles FROM anon, authenticated;
    GRANT SELECT ON public.candles TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quote_snapshots') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.quote_snapshots FROM anon, authenticated;
    GRANT SELECT ON public.quote_snapshots TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'market_cap_classifications') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_cap_classifications FROM anon, authenticated;
    GRANT SELECT ON public.market_cap_classifications TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sectors') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sectors FROM anon, authenticated;
    GRANT SELECT ON public.sectors TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'peers') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.peers FROM anon, authenticated;
    GRANT SELECT ON public.peers TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'option_chain') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.option_chain FROM anon, authenticated;
    GRANT SELECT ON public.option_chain TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'corporate_actions') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.corporate_actions FROM anon, authenticated;
    GRANT SELECT ON public.corporate_actions TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shareholding_patterns') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shareholding_patterns FROM anon, authenticated;
    GRANT SELECT ON public.shareholding_patterns TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'institutional_deals') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.institutional_deals FROM anon, authenticated;
    GRANT SELECT ON public.institutional_deals TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'index_valuations') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.index_valuations FROM anon, authenticated;
    GRANT SELECT ON public.index_valuations TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'market_baseline_metrics') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_baseline_metrics FROM anon, authenticated;
    GRANT SELECT ON public.market_baseline_metrics TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'live_intraday_snapshots') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.live_intraday_snapshots FROM anon, authenticated;
    GRANT SELECT ON public.live_intraday_snapshots TO anon, authenticated;
  END IF;

  -- 3. REVOKE ALL PERMISSIONS FROM ANON & AUTHENTICATED ON INTERNAL INGESTION TABLES
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ingestion_runs') THEN
    REVOKE ALL ON public.ingestion_runs FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dead_letter_queue') THEN
    REVOKE ALL ON public.dead_letter_queue FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calculation_results') THEN
    REVOKE ALL ON public.calculation_results FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'anomaly_flags') THEN
    REVOKE ALL ON public.anomaly_flags FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'source_audit') THEN
    REVOKE ALL ON public.source_audit FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'idempotency') THEN
    REVOKE ALL ON public.idempotency FROM anon, authenticated;
  END IF;

END $$;
