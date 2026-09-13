-- Migration 0021: Technical Snapshots Pipeline
-- Stores canonical pre-computed technical indicators across the equity universe
-- for high-performance whole-universe server-side screening.

CREATE TABLE IF NOT EXISTS public.technical_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  timeframe TEXT NOT NULL DEFAULT '1d',
  as_of TIMESTAMPTZ NOT NULL,
  close NUMERIC(18, 4) NOT NULL,
  
  -- Moving averages
  sma20 NUMERIC(18, 4),
  sma50 NUMERIC(18, 4),
  sma200 NUMERIC(18, 4),
  ema20 NUMERIC(18, 4),
  ema50 NUMERIC(18, 4),
  ema200 NUMERIC(18, 4),
  
  -- Momentum & Trend
  rsi14 NUMERIC(8, 4),
  macd NUMERIC(18, 4),
  macd_signal NUMERIC(18, 4),
  macd_histogram NUMERIC(18, 4),
  
  -- Volatility
  atr14 NUMERIC(18, 4),
  adx14 NUMERIC(8, 4),
  bb_upper NUMERIC(18, 4),
  bb_middle NUMERIC(18, 4),
  bb_lower NUMERIC(18, 4),
  bb_width NUMERIC(10, 4),
  
  -- Volume
  volume BIGINT DEFAULT 0,
  average_volume20 BIGINT,
  relative_volume20 NUMERIC(10, 4),
  
  -- Extremes & Distances
  high20 NUMERIC(18, 4),
  low20 NUMERIC(18, 4),
  high52w NUMERIC(18, 4),
  low52w NUMERIC(18, 4),
  distance_from_sma20_pct NUMERIC(10, 4),
  distance_from_sma50_pct NUMERIC(10, 4),
  distance_from_sma200_pct NUMERIC(10, 4),
  distance_from_52week_high_pct NUMERIC(10, 4),
  distance_from_52week_low_pct NUMERIC(10, 4),
  
  -- Boolean state flags
  price_above_sma20 BOOLEAN,
  price_above_sma50 BOOLEAN,
  price_above_sma200 BOOLEAN,
  
  -- Engine metadata & versioning
  indicator_engine_version TEXT NOT NULL DEFAULT '1.0.0',
  source_timestamp TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique key per symbol, exchange, timeframe for current-snapshot model
CREATE UNIQUE INDEX IF NOT EXISTS idx_technical_snapshots_identity_unique
  ON public.technical_snapshots (symbol, exchange, timeframe);

-- Indexes for frequent screener filter & sort columns
CREATE INDEX IF NOT EXISTS idx_technical_snapshots_symbol_tf
  ON public.technical_snapshots (symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_technical_snapshots_rsi14
  ON public.technical_snapshots (rsi14);

CREATE INDEX IF NOT EXISTS idx_technical_snapshots_rel_volume
  ON public.technical_snapshots (relative_volume20);

CREATE INDEX IF NOT EXISTS idx_technical_snapshots_updated_at
  ON public.technical_snapshots (updated_at);
