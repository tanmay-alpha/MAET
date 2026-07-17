-- BigQuery DDL: maet_analytics dataset tables
-- Run each statement separately in BigQuery console or via MCP execute_sql

-- ============================================================================
-- 1. market_ticks — raw OHLCV bars (daily + intraday)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.market_ticks` (
  symbol          STRING    NOT NULL,
  timestamp       TIMESTAMP NOT NULL,
  timeframe       STRING    NOT NULL,  -- '1d', '1wk', '5min', '1min'
  open            FLOAT64   NOT NULL,
  high            FLOAT64   NOT NULL,
  low             FLOAT64   NOT NULL,
  close           FLOAT64   NOT NULL,
  volume          INT64     NOT NULL,
  turnover        FLOAT64,
  adjusted_close  FLOAT64,
  source_tag      STRING    NOT NULL,  -- 'yahoo', 'angelone', 'nse'
  ingested_at     TIMESTAMP NOT NULL
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol
OPTIONS (
  description = 'OHLCV bars for all symbols across timeframes. Partitioned by date, clustered by symbol.'
);

-- ============================================================================
-- 2. indicator_values — computed technical indicator results
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.indicator_values` (
  symbol            STRING    NOT NULL,
  date              DATE      NOT NULL,
  indicator_name    STRING    NOT NULL,  -- 'SMA_20', 'RSI_14', 'MACD_SIGNAL', etc.
  indicator_value   FLOAT64,
  indicator_signal  FLOAT64,             -- secondary line (e.g., MACD signal line)
  indicator_hist    FLOAT64,             -- tertiary value (e.g., MACD histogram)
  parameters        JSON,                -- {"period": 20, "source": "close"}
  timeframe         STRING    NOT NULL   DEFAULT '1d',
  calculated_at     TIMESTAMP NOT NULL,
  source_tag        STRING    NOT NULL   DEFAULT 'calculation-engine'
)
PARTITION BY date
CLUSTER BY symbol, indicator_name
OPTIONS (
  description = 'Computed technical indicator values. Partitioned by date, clustered by symbol+indicator.'
);

-- ============================================================================
-- 3. fundamental_scores — fundamental analysis results
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.fundamental_scores` (
  symbol          STRING    NOT NULL,
  period          DATE      NOT NULL,
  period_type     STRING    NOT NULL,   -- 'quarterly', 'annual', 'ttm'
  score_type      STRING    NOT NULL,   -- 'piotroski_f', 'altman_z', 'beneish_m', 'graham_number'
  score_value     FLOAT64,
  components      JSON,                 -- breakdown of score components
  calculated_at   TIMESTAMP NOT NULL,
  source_tag      STRING    NOT NULL   DEFAULT 'calculation-engine'
)
PARTITION BY period
CLUSTER BY symbol
OPTIONS (
  description = 'Composite fundamental scores (Piotroski, Altman Z, Beneish M, etc.).'
);

-- ============================================================================
-- 4. peer_comparisons — cross-company metric benchmarking
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.peer_comparisons` (
  symbol            STRING    NOT NULL,
  peer_symbol       STRING    NOT NULL,
  comparison_date   DATE      NOT NULL,
  metric            STRING    NOT NULL,  -- 'pe_ratio', 'roe', 'revenue_growth'
  symbol_value      FLOAT64,
  peer_value        FLOAT64,
  sector            STRING,
  percentile_rank   FLOAT64,             -- 0-100 within peer group
  calculated_at     TIMESTAMP NOT NULL,
  source_tag        STRING    NOT NULL   DEFAULT 'calculation-engine'
)
PARTITION BY comparison_date
CLUSTER BY symbol
OPTIONS (
  description = 'Peer group comparison metrics. Used for relative valuation.'
);

-- ============================================================================
-- 5. sector_flows — FII/DII sector flow aggregates
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.sector_flows` (
  sector              STRING    NOT NULL,
  date                DATE      NOT NULL,
  inflow_crores       FLOAT64,
  outflow_crores      FLOAT64,
  net_flow_crores     FLOAT64,
  advance_count       INT64,
  decline_count       INT64,
  unchanged_count     INT64,
  total_market_cap    FLOAT64,
  avg_pe_ratio        FLOAT64,
  ingested_at         TIMESTAMP NOT NULL,
  source_tag          STRING    NOT NULL  DEFAULT 'nse'
)
PARTITION BY date
CLUSTER BY sector
OPTIONS (
  description = 'Daily sector-level FII/DII flow and breadth data.'
);

-- ============================================================================
-- 6. price_scans — scanner results snapshot
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.price_scans` (
  scan_date       DATE      NOT NULL,
  scan_type       STRING    NOT NULL,   -- '52w_high', 'rsi_oversold', 'macd_crossover'
  symbol          STRING    NOT NULL,
  signal          STRING    NOT NULL,   -- 'BUY', 'SELL', 'NEUTRAL'
  strength        FLOAT64,              -- 0-100
  price           FLOAT64,
  volume          INT64,
  metadata        JSON,                 -- indicator values that triggered signal
  calculated_at   TIMESTAMP NOT NULL,
  source_tag      STRING    NOT NULL    DEFAULT 'scanner-engine'
)
PARTITION BY scan_date
CLUSTER BY scan_type, symbol
OPTIONS (
  description = 'Daily scanner run results. Used for historical signal analysis.'
);

-- ============================================================================
-- 7. backtest_results — backtest outcome persistence
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.backtest_results` (
  strategy_name     STRING    NOT NULL,
  run_date          DATE      NOT NULL,
  symbol            STRING    NOT NULL,
  start_date        DATE      NOT NULL,
  end_date          DATE      NOT NULL,
  total_return      FLOAT64,
  cagr              FLOAT64,
  max_drawdown      FLOAT64,
  sharpe            FLOAT64,
  sortino           FLOAT64,
  calmar            FLOAT64,
  win_rate          FLOAT64,
  trades_count      INT64,
  profit_factor     FLOAT64,
  parameters        JSON,               -- strategy parameters used
  equity_curve      JSON,               -- [{date, value}] array
  trades            JSON,               -- [{entry, exit, pnl}] array
  run_by            STRING,             -- user_id or 'system'
  run_at            TIMESTAMP NOT NULL
)
PARTITION BY run_date
CLUSTER BY strategy_name, symbol
OPTIONS (
  description = 'Backtest run results. Full equity curve and trade list stored as JSON.'
);

-- ============================================================================
-- 8. user_analytics — user behavior tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS `maet_analytics.user_analytics` (
  user_id             STRING    NOT NULL,
  session_date        DATE      NOT NULL,
  features_used       JSON,              -- ['screener', 'chart', 'portfolio']
  watchlist_count     INT64,
  orders_placed       INT64,
  screen_runs         INT64,
  backtest_runs       INT64,
  symbols_viewed      JSON,              -- list of symbols viewed
  session_duration_s  INT64,
  ingested_at         TIMESTAMP NOT NULL
)
PARTITION BY session_date
CLUSTER BY user_id
OPTIONS (
  description = 'Daily user activity aggregates for product analytics.'
);
