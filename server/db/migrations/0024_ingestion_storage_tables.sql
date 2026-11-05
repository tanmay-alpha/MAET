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
--
-- Databases bootstrapped by apply-migrations.ts before commit eed4850 contain
-- empty placeholder tables `(id uuid PRIMARY KEY)` under these names. The DO
-- blocks below complete such placeholders in place (add the real columns and
-- a UNIQUE key matching the writers' ON CONFLICT targets) instead of dropping
-- them; real tables are left untouched.

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.price_daily') AND attname = 'symbol' AND NOT attisdropped) THEN
    ALTER TABLE public.price_daily
      ADD COLUMN symbol TEXT NOT NULL, ADD COLUMN date DATE NOT NULL,
      ADD COLUMN open NUMERIC(18,4) NOT NULL, ADD COLUMN high NUMERIC(18,4) NOT NULL,
      ADD COLUMN low NUMERIC(18,4) NOT NULL, ADD COLUMN close NUMERIC(18,4) NOT NULL,
      ADD COLUMN volume BIGINT NOT NULL DEFAULT 0, ADD COLUMN adjusted_close NUMERIC(18,4),
      ADD COLUMN turnover NUMERIC(24,2), ADD COLUMN source_tag TEXT NOT NULL DEFAULT 'yahoo',
      ADD COLUMN ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ADD COLUMN raw_payload JSONB,
      ADD CONSTRAINT price_daily_symbol_date_key UNIQUE (symbol, date);
  END IF;
END $$;

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.calculation_results') AND attname = 'symbol' AND NOT attisdropped) THEN
    ALTER TABLE public.calculation_results
      ADD COLUMN symbol TEXT NOT NULL, ADD COLUMN date DATE NOT NULL,
      ADD COLUMN indicator_name TEXT NOT NULL, ADD COLUMN indicator_value NUMERIC(18,6),
      ADD COLUMN indicator_signal NUMERIC(18,6), ADD COLUMN indicator_hist NUMERIC(18,6),
      ADD COLUMN timeframe TEXT NOT NULL DEFAULT '1d', ADD COLUMN parameters JSONB,
      ADD COLUMN calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD CONSTRAINT calculation_results_natural_key UNIQUE (symbol, date, indicator_name, timeframe);
  END IF;
END $$;

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.market_baseline_metrics') AND attname = 'symbol' AND NOT attisdropped) THEN
    ALTER TABLE public.market_baseline_metrics
      ADD COLUMN symbol TEXT NOT NULL, ADD COLUMN adv_30 NUMERIC NOT NULL,
      ADD COLUMN atr_14 NUMERIC NOT NULL, ADD COLUMN last_trading_date DATE NOT NULL,
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD CONSTRAINT market_baseline_metrics_symbol_key UNIQUE (symbol);
  END IF;
END $$;

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
