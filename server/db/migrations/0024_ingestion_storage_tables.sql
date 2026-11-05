-- 0024: canonical DDL for ingestion storage tables
--
-- price_daily and calculation_results were only defined in a second, never
-- applied migration tree (workers/ingestion-engine/storage/supabase-schema),
-- and market_baseline_metrics was never created at all even though
-- server/db/seeds/market_baseline_metrics.sql loads it. Fresh databases built
-- from this directory therefore lacked tables that the ingestion writer, the
-- technical screener fallback and the health/ingestion reports query.
--
-- Column definitions match the retired DDL (and the columns the seed file
-- inserts). Everything is IF NOT EXISTS / DROP POLICY IF EXISTS so databases
-- that already have these tables keep their data. RLS and grants mirror what
-- 0009/0010 apply when the tables exist.

-- ============================================================================
-- price_daily: daily OHLCV written by the ingestion engine
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.price_daily (
  symbol            TEXT          NOT NULL,
  date              DATE          NOT NULL,
  open              NUMERIC(18,4) NOT NULL,
  high              NUMERIC(18,4) NOT NULL,
  low               NUMERIC(18,4) NOT NULL,
  close             NUMERIC(18,4) NOT NULL,
  volume            BIGINT        NOT NULL DEFAULT 0,
  adjusted_close    NUMERIC(18,4),
  turnover          NUMERIC(24,2),
  source_tag        TEXT          NOT NULL DEFAULT 'yahoo',
  ingested_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  raw_payload       JSONB,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS price_daily_symbol_date_idx ON public.price_daily (symbol, date DESC);
CREATE INDEX IF NOT EXISTS price_daily_date_idx ON public.price_daily (date DESC);

-- ============================================================================
-- calculation_results: cache of computed indicator values
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.calculation_results (
  symbol            TEXT          NOT NULL,
  date              DATE          NOT NULL,
  indicator_name    TEXT          NOT NULL,  -- 'RSI_14', 'SMA_20', etc.
  indicator_value   NUMERIC(18,6),
  indicator_signal  NUMERIC(18,6),
  indicator_hist    NUMERIC(18,6),
  timeframe         TEXT          NOT NULL DEFAULT '1d',
  parameters        JSONB,
  calculated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, date, indicator_name, timeframe)
);

CREATE INDEX IF NOT EXISTS calc_results_symbol_date_idx ON public.calculation_results (symbol, date DESC);
CREATE INDEX IF NOT EXISTS calc_results_indicator_idx ON public.calculation_results (indicator_name, date DESC);

-- ============================================================================
-- market_baseline_metrics: per-symbol 30-day ADV and 14-day ATR baselines
-- (seeded from server/db/seeds/market_baseline_metrics.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.market_baseline_metrics (
  symbol            TEXT          PRIMARY KEY,
  adv_30            NUMERIC       NOT NULL,
  atr_14            NUMERIC       NOT NULL,
  last_trading_date DATE          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Row level security and grants (same names and rules as 0009/0010)
-- ============================================================================
ALTER TABLE public.price_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_daily_select_public ON public.price_daily;
DROP POLICY IF EXISTS price_daily_service_role ON public.price_daily;
CREATE POLICY price_daily_select_public ON public.price_daily FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY price_daily_service_role ON public.price_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_daily FROM anon, authenticated;
GRANT SELECT ON public.price_daily TO anon, authenticated;

ALTER TABLE public.market_baseline_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_baseline_metrics_select_public ON public.market_baseline_metrics;
DROP POLICY IF EXISTS market_baseline_metrics_service_role ON public.market_baseline_metrics;
CREATE POLICY market_baseline_metrics_select_public ON public.market_baseline_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY market_baseline_metrics_service_role ON public.market_baseline_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.market_baseline_metrics FROM anon, authenticated;
GRANT SELECT ON public.market_baseline_metrics TO anon, authenticated;

ALTER TABLE public.calculation_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calculation_results_service_role ON public.calculation_results;
CREATE POLICY calculation_results_service_role ON public.calculation_results FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calculation_results FROM anon, authenticated;
