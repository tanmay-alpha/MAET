-- Phase 0.1: Financial Integrity Remediation — Remove Legacy Permissive RLS Policies
-- Project: MAET (Confirmed project_id: ztpbfmpfgmgmsitshzma)
-- Description: Drops legacy permissive and duplicate policies, revokes table write privileges from anon/authenticated on public market tables, and ensures fail-closed RLS access.

DO $$
BEGIN
  -- 1. DROP LEGACY DUPLICATE / UNSTRUCTURED POLICIES
  DROP POLICY IF EXISTS "service write price_daily" ON public.price_daily;
  DROP POLICY IF EXISTS "service write price_intraday" ON public.price_intraday;
  DROP POLICY IF EXISTS "service write sectors" ON public.sectors;
  DROP POLICY IF EXISTS "service write peers" ON public.peers;
  DROP POLICY IF EXISTS "service write ingestion_runs" ON public.ingestion_runs;
  DROP POLICY IF EXISTS "service write dead_letter_queue" ON public.dead_letter_queue;
  DROP POLICY IF EXISTS "service write calculation_results" ON public.calculation_results;

  DROP POLICY IF EXISTS "public company master read" ON public.companies;
  DROP POLICY IF EXISTS "public company identifiers read" ON public.company_identifiers;
  DROP POLICY IF EXISTS "public financial statements read" ON public.financial_statements;
  DROP POLICY IF EXISTS "public fundamentals read" ON public.fundamentals;
  DROP POLICY IF EXISTS "public market cap classifications read" ON public.market_cap_classifications;
  DROP POLICY IF EXISTS "public quote snapshots read" ON public.quote_snapshots;

  DROP POLICY IF EXISTS "backtest runs own rows" ON public.backtest_runs;
  DROP POLICY IF EXISTS "brokers own rows" ON public.brokers;
  DROP POLICY IF EXISTS "orders own rows" ON public.orders;
  DROP POLICY IF EXISTS "screener runs own rows" ON public.screener_runs;
  DROP POLICY IF EXISTS "users read own row" ON public.users;
  DROP POLICY IF EXISTS "users update own row" ON public.users;
  DROP POLICY IF EXISTS "watchlist own rows" ON public.watchlist;

  -- 2. REVOKE DIRECT TABLE WRITE PERMISSIONS FROM ANON & AUTHENTICATED ON MARKET TABLES
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.companies FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fundamentals FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.company_identifiers FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.financial_statements FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_daily FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_intraday FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.candles FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.quote_snapshots FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_cap_classifications FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sectors FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.peers FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.option_chain FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.corporate_actions FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shareholding_patterns FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.institutional_deals FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.index_valuations FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_baseline_metrics FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.live_intraday_snapshots FROM anon, authenticated;

  -- 3. REVOKE ALL PERMISSIONS FROM ANON & AUTHENTICATED ON INTERNAL INGESTION TABLES
  REVOKE ALL ON public.ingestion_runs FROM anon, authenticated;
  REVOKE ALL ON public.dead_letter_queue FROM anon, authenticated;
  REVOKE ALL ON public.calculation_results FROM anon, authenticated;
  REVOKE ALL ON public.anomaly_flags FROM anon, authenticated;
  REVOKE ALL ON public.source_audit FROM anon, authenticated;
  REVOKE ALL ON public.idempotency FROM anon, authenticated;

  -- 4. ENSURE INTENTIONAL PUBLIC SELECT GRANTS
  GRANT SELECT ON public.companies TO anon, authenticated;
  GRANT SELECT ON public.fundamentals TO anon, authenticated;
  GRANT SELECT ON public.company_identifiers TO anon, authenticated;
  GRANT SELECT ON public.financial_statements TO anon, authenticated;
  GRANT SELECT ON public.price_daily TO anon, authenticated;
  GRANT SELECT ON public.price_intraday TO anon, authenticated;
  GRANT SELECT ON public.candles TO anon, authenticated;
  GRANT SELECT ON public.quote_snapshots TO anon, authenticated;
  GRANT SELECT ON public.market_cap_classifications TO anon, authenticated;
  GRANT SELECT ON public.sectors TO anon, authenticated;
  GRANT SELECT ON public.peers TO anon, authenticated;
  GRANT SELECT ON public.option_chain TO anon, authenticated;
  GRANT SELECT ON public.corporate_actions TO anon, authenticated;
  GRANT SELECT ON public.shareholding_patterns TO anon, authenticated;
  GRANT SELECT ON public.institutional_deals TO anon, authenticated;
  GRANT SELECT ON public.index_valuations TO anon, authenticated;
  GRANT SELECT ON public.market_baseline_metrics TO anon, authenticated;
  GRANT SELECT ON public.live_intraday_snapshots TO anon, authenticated;

END $$;
