-- Supabase migration: ingestion engine supporting tables
-- Migration: 0009_ingestion_engine
-- Adds: price_daily, price_intraday, sectors, peers tables
-- Enhances: corporate_actions with source tracking

-- ============================================================================
-- price_daily: partitioned daily OHLCV (complement to existing candles table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.price_daily (
  symbol            TEXT        NOT NULL,
  date              DATE        NOT NULL,
  open              NUMERIC(18,4) NOT NULL,
  high              NUMERIC(18,4) NOT NULL,
  low               NUMERIC(18,4) NOT NULL,
  close             NUMERIC(18,4) NOT NULL,
  volume            BIGINT      NOT NULL DEFAULT 0,
  adjusted_close    NUMERIC(18,4),
  turnover          NUMERIC(24,2),
  source_tag        TEXT        NOT NULL DEFAULT 'yahoo',
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload       JSONB,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS price_daily_symbol_date_idx ON public.price_daily (symbol, date DESC);
CREATE INDEX IF NOT EXISTS price_daily_date_idx ON public.price_daily (date DESC);

-- ============================================================================
-- price_intraday: intraday OHLCV snapshots
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.price_intraday (
  symbol            TEXT        NOT NULL,
  ts                TIMESTAMPTZ NOT NULL,
  timeframe         TEXT        NOT NULL DEFAULT '5min',  -- '1min', '5min', '15min'
  open              NUMERIC(18,4) NOT NULL,
  high              NUMERIC(18,4) NOT NULL,
  low               NUMERIC(18,4) NOT NULL,
  close             NUMERIC(18,4) NOT NULL,
  volume            BIGINT      NOT NULL DEFAULT 0,
  source_tag        TEXT        NOT NULL DEFAULT 'angelone',
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, ts, timeframe)
);

CREATE INDEX IF NOT EXISTS price_intraday_symbol_ts_idx ON public.price_intraday (symbol, ts DESC);

-- ============================================================================
-- sectors: sector and industry taxonomy
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sectors (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name              TEXT        NOT NULL UNIQUE,
  parent_id         TEXT        REFERENCES public.sectors(id),
  level             INTEGER     NOT NULL DEFAULT 1,  -- 1=macro sector, 2=sector, 3=sub-sector
  bse_code          TEXT,
  nse_code          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sectors_parent_idx ON public.sectors (parent_id);
CREATE INDEX IF NOT EXISTS sectors_nse_code_idx ON public.sectors (nse_code);

-- ============================================================================
-- peers: peer company mappings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.peers (
  symbol            TEXT        NOT NULL,
  peer_symbol       TEXT        NOT NULL,
  peer_score        NUMERIC(5,2) DEFAULT 1.0,  -- similarity score 0-1
  sector            TEXT,
  basis             TEXT        DEFAULT 'sector',  -- 'sector', 'market_cap', 'manual'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, peer_symbol)
);

CREATE INDEX IF NOT EXISTS peers_symbol_idx ON public.peers (symbol);
CREATE INDEX IF NOT EXISTS peers_sector_idx ON public.peers (sector);

-- ============================================================================
-- ingestion_runs: dead-letter queue and run tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ingestion_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT        NOT NULL,
  source            TEXT        NOT NULL,   -- 'nse-equities', 'yahoo-history', etc.
  pipeline          TEXT        NOT NULL,   -- 'daily', 'realtime', 'weekly'
  status            TEXT        NOT NULL DEFAULT 'running',  -- 'running', 'success', 'failed', 'partial'
  symbols_attempted INTEGER     NOT NULL DEFAULT 0,
  symbols_succeeded INTEGER     NOT NULL DEFAULT 0,
  symbols_failed    INTEGER     NOT NULL DEFAULT 0,
  records_inserted  INTEGER     NOT NULL DEFAULT 0,
  records_updated   INTEGER     NOT NULL DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  duration_ms       INTEGER,
  metadata          JSONB
);

CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx ON public.ingestion_runs (source, started_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_runs_status_idx ON public.ingestion_runs (status);
CREATE INDEX IF NOT EXISTS ingestion_runs_run_id_idx ON public.ingestion_runs (run_id);

-- ============================================================================
-- dead_letter_queue: failed ingestion records
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dead_letter_queue (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT        NOT NULL,
  pipeline          TEXT        NOT NULL,
  symbol            TEXT,
  error_code        TEXT        NOT NULL,
  error_message     TEXT        NOT NULL,
  raw_payload       JSONB,
  retry_count       INTEGER     NOT NULL DEFAULT 0,
  max_retries       INTEGER     NOT NULL DEFAULT 3,
  next_retry_at     TIMESTAMPTZ,
  resolved          BOOLEAN     NOT NULL DEFAULT false,
  resolved_at       TIMESTAMPTZ,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dlq_source_idx ON public.dead_letter_queue (source, created_at DESC);
CREATE INDEX IF NOT EXISTS dlq_resolved_idx ON public.dead_letter_queue (resolved, next_retry_at);
CREATE INDEX IF NOT EXISTS dlq_symbol_idx ON public.dead_letter_queue (symbol);

-- ============================================================================
-- calculation_results: cache for computed indicator values
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.calculation_results (
  symbol            TEXT        NOT NULL,
  date              DATE        NOT NULL,
  indicator_name    TEXT        NOT NULL,  -- 'RSI_14', 'SMA_20', etc.
  indicator_value   NUMERIC(18,6),
  indicator_signal  NUMERIC(18,6),
  indicator_hist    NUMERIC(18,6),
  timeframe         TEXT        NOT NULL DEFAULT '1d',
  parameters        JSONB,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, date, indicator_name, timeframe)
);

CREATE INDEX IF NOT EXISTS calc_results_symbol_date_idx ON public.calculation_results (symbol, date DESC);
CREATE INDEX IF NOT EXISTS calc_results_indicator_idx ON public.calculation_results (indicator_name, date DESC);

-- Enable RLS on all new tables
ALTER TABLE public.price_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_intraday ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_results ENABLE ROW LEVEL SECURITY;

-- Public read access for market data tables
CREATE POLICY "public read price_daily" ON public.price_daily FOR SELECT USING (true);
CREATE POLICY "public read price_intraday" ON public.price_intraday FOR SELECT USING (true);
CREATE POLICY "public read sectors" ON public.sectors FOR SELECT USING (true);
CREATE POLICY "public read peers" ON public.peers FOR SELECT USING (true);
CREATE POLICY "public read calculation_results" ON public.calculation_results FOR SELECT USING (true);

-- Service role write access
CREATE POLICY "service write price_daily" ON public.price_daily FOR ALL USING (true);
CREATE POLICY "service write price_intraday" ON public.price_intraday FOR ALL USING (true);
CREATE POLICY "service write sectors" ON public.sectors FOR ALL USING (true);
CREATE POLICY "service write peers" ON public.peers FOR ALL USING (true);
CREATE POLICY "service write ingestion_runs" ON public.ingestion_runs FOR ALL USING (true);
CREATE POLICY "service write dead_letter_queue" ON public.dead_letter_queue FOR ALL USING (true);
CREATE POLICY "service write calculation_results" ON public.calculation_results FOR ALL USING (true);
