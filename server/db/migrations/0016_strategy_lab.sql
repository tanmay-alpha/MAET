-- =============================================================================
-- Migration 0016: Strategy Lab
-- Adds 14 forward-only tables for the Phase 3 strategy definition, versioning,
-- backtesting, parameter optimisation, walk-forward analysis, paper deployment,
-- signal events, execution decisions, and bar replay.
--
-- Additive only. Zero DROP TABLE. Zero CASCADE data loss.
-- Existing backtest_runs table is extended with a nullable FK.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend existing backtest_runs with strategy_version_id (nullable, additive)
-- ---------------------------------------------------------------------------

ALTER TABLE public.backtest_runs
  ADD COLUMN IF NOT EXISTS strategy_version_id uuid;

-- ---------------------------------------------------------------------------
-- 1. strategy_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'VALIDATED', 'ARCHIVED')),
  current_draft   jsonb NOT NULL,
  schema_version  integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  CONSTRAINT strategy_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT strategy_desc_length CHECK (description IS NULL OR char_length(description) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_strategy_definitions_user_updated
  ON public.strategy_definitions(user_id, updated_at DESC);

ALTER TABLE public.strategy_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategy_definitions_owner ON public.strategy_definitions;
CREATE POLICY strategy_definitions_owner
  ON public.strategy_definitions
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. strategy_versions (immutable snapshots)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id         uuid NOT NULL REFERENCES public.strategy_definitions(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_number      integer NOT NULL,
  definition          jsonb NOT NULL,
  definition_hash     text NOT NULL,
  engine_version      text NOT NULL,
  indicator_version   text NOT NULL,
  schema_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_strategy_version UNIQUE (strategy_id, version_number),
  CONSTRAINT unique_strategy_definition_hash UNIQUE (strategy_id, definition_hash)
);

CREATE INDEX IF NOT EXISTS idx_strategy_versions_strategy_id
  ON public.strategy_versions(strategy_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_user_id
  ON public.strategy_versions(user_id);

ALTER TABLE public.strategy_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategy_versions_owner ON public.strategy_versions;
CREATE POLICY strategy_versions_owner
  ON public.strategy_versions
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. strategy_backtest_jobs (durable job queue)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_backtest_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_version_id  uuid NOT NULL REFERENCES public.strategy_versions(id),
  status               text NOT NULL DEFAULT 'QUEUED'
                         CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  symbol_or_universe   text NOT NULL,
  timeframe            text NOT NULL,
  from_date            timestamptz NOT NULL,
  to_date              timestamptz NOT NULL,
  initial_capital      numeric(18, 4),
  benchmark_symbol     text,
  progress             integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code           text,
  error_summary        text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  cancel_requested_at  timestamptz,
  worker_id            text,
  heartbeat_at         timestamptz,
  run_id               uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backtest_jobs_user_status
  ON public.strategy_backtest_jobs(user_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_jobs_status_queued
  ON public.strategy_backtest_jobs(status, requested_at)
  WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS idx_backtest_jobs_version
  ON public.strategy_backtest_jobs(strategy_version_id);

ALTER TABLE public.strategy_backtest_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backtest_jobs_owner ON public.strategy_backtest_jobs;
CREATE POLICY backtest_jobs_owner
  ON public.strategy_backtest_jobs
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. strategy_backtest_trades (trade-level results)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_backtest_trades (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   uuid NOT NULL REFERENCES public.strategy_backtest_jobs(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_version_id      uuid NOT NULL REFERENCES public.strategy_versions(id),
  symbol                   text NOT NULL,
  direction                text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  entry_signal_timestamp   timestamptz,
  entry_order_timestamp    timestamptz,
  entry_fill_timestamp     timestamptz,
  entry_price              numeric(18, 4) NOT NULL,
  entry_quantity           numeric(18, 4) NOT NULL,
  exit_signal_timestamp    timestamptz,
  exit_fill_timestamp      timestamptz,
  exit_price               numeric(18, 4),
  exit_quantity            numeric(18, 4),
  gross_pnl                numeric(18, 4),
  fees                     numeric(18, 4) NOT NULL DEFAULT 0,
  slippage                 numeric(18, 4) NOT NULL DEFAULT 0,
  net_pnl                  numeric(18, 4),
  return_percent           numeric(12, 6),
  holding_bars             integer,
  holding_seconds          bigint,
  mfe                      numeric(18, 4),
  mae                      numeric(18, 4),
  entry_reason             text,
  exit_reason              text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_job_id
  ON public.strategy_backtest_trades(job_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_user_symbol
  ON public.strategy_backtest_trades(user_id, symbol);

ALTER TABLE public.strategy_backtest_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backtest_trades_owner ON public.strategy_backtest_trades;
CREATE POLICY backtest_trades_owner
  ON public.strategy_backtest_trades
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. strategy_equity_points (equity curve, downsampled for storage)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_equity_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES public.strategy_backtest_jobs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  timestamp   timestamptz NOT NULL,
  equity      numeric(18, 4) NOT NULL,
  benchmark   numeric(18, 4),
  drawdown    numeric(12, 6)
);

CREATE INDEX IF NOT EXISTS idx_equity_points_job_ts
  ON public.strategy_equity_points(job_id, timestamp ASC);

ALTER TABLE public.strategy_equity_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equity_points_owner ON public.strategy_equity_points;
CREATE POLICY equity_points_owner
  ON public.strategy_equity_points
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. strategy_parameter_sweeps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_parameter_sweeps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_id     uuid NOT NULL REFERENCES public.strategy_definitions(id) ON DELETE CASCADE,
  parameters      jsonb NOT NULL,
  combination_count integer NOT NULL,
  symbol_or_universe text NOT NULL,
  timeframe       text NOT NULL,
  from_date       timestamptz NOT NULL,
  to_date         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  completed_count integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sweeps_user_strategy
  ON public.strategy_parameter_sweeps(user_id, strategy_id, created_at DESC);

ALTER TABLE public.strategy_parameter_sweeps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sweeps_owner ON public.strategy_parameter_sweeps;
CREATE POLICY sweeps_owner
  ON public.strategy_parameter_sweeps
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. strategy_sweep_results (one row per parameter combination)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_sweep_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id             uuid NOT NULL REFERENCES public.strategy_parameter_sweeps(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parameter_values     jsonb NOT NULL,
  combination_index    integer NOT NULL,
  job_id               uuid REFERENCES public.strategy_backtest_jobs(id),
  result_summary       jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sweep_results_sweep_id
  ON public.strategy_sweep_results(sweep_id, combination_index);

ALTER TABLE public.strategy_sweep_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sweep_results_owner ON public.strategy_sweep_results;
CREATE POLICY sweep_results_owner
  ON public.strategy_sweep_results
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. strategy_walk_forward_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_walk_forward_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_id     uuid NOT NULL REFERENCES public.strategy_definitions(id) ON DELETE CASCADE,
  mode            text NOT NULL CHECK (mode IN ('ANCHORED', 'ROLLING')),
  parameters      jsonb NOT NULL,
  symbol          text NOT NULL,
  timeframe       text NOT NULL,
  from_date       timestamptz NOT NULL,
  to_date         timestamptz NOT NULL,
  training_days   integer NOT NULL,
  validation_days integer NOT NULL,
  window_count    integer NOT NULL,
  status          text NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  oos_summary     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_runs_user
  ON public.strategy_walk_forward_runs(user_id, created_at DESC);

ALTER TABLE public.strategy_walk_forward_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wf_runs_owner ON public.strategy_walk_forward_runs;
CREATE POLICY wf_runs_owner
  ON public.strategy_walk_forward_runs
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 9. strategy_walk_forward_windows (one row per train/validate window)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_walk_forward_windows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid NOT NULL REFERENCES public.strategy_walk_forward_runs(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  window_index         integer NOT NULL,
  training_from        timestamptz NOT NULL,
  training_to          timestamptz NOT NULL,
  validation_from      timestamptz NOT NULL,
  validation_to        timestamptz NOT NULL,
  selected_parameters  jsonb,
  training_metrics     jsonb,
  validation_metrics   jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_windows_run_id
  ON public.strategy_walk_forward_windows(run_id, window_index);

ALTER TABLE public.strategy_walk_forward_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wf_windows_owner ON public.strategy_walk_forward_windows;
CREATE POLICY wf_windows_owner
  ON public.strategy_walk_forward_windows
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10. strategy_deployments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_deployments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_version_id  uuid NOT NULL REFERENCES public.strategy_versions(id),
  mode                 text NOT NULL DEFAULT 'OFF'
                         CHECK (mode IN ('OFF', 'ALERT_ONLY', 'MANUAL_CONFIRM', 'AUTO_PAPER')),
  universe             text NOT NULL,
  timeframe            text NOT NULL,
  status               text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'STOPPED', 'ERROR')),
  risk_limits          jsonb NOT NULL DEFAULT '{}',
  user_kill_switch     boolean NOT NULL DEFAULT false,
  deployment_kill_switch boolean NOT NULL DEFAULT false,
  started_at           timestamptz,
  paused_at            timestamptz,
  stopped_at           timestamptz,
  last_evaluated_at    timestamptz,
  last_signal_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_user_status
  ON public.strategy_deployments(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_version_id
  ON public.strategy_deployments(strategy_version_id);
CREATE INDEX IF NOT EXISTS idx_deployments_active
  ON public.strategy_deployments(status, timeframe)
  WHERE status = 'ACTIVE';

ALTER TABLE public.strategy_deployments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deployments_owner ON public.strategy_deployments;
CREATE POLICY deployments_owner
  ON public.strategy_deployments
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 11. strategy_signal_events (deduplicated signals from evaluation worker)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_signal_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id         uuid NOT NULL REFERENCES public.strategy_deployments(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_version_id   uuid NOT NULL REFERENCES public.strategy_versions(id),
  symbol                text NOT NULL,
  timeframe             text NOT NULL,
  bar_close_timestamp   timestamptz NOT NULL,
  signal_type           text NOT NULL,
  fingerprint           text NOT NULL,
  indicator_snapshot    jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_signal_fingerprint UNIQUE (deployment_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_signals_deployment_ts
  ON public.strategy_signal_events(deployment_id, bar_close_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_user_ts
  ON public.strategy_signal_events(user_id, created_at DESC);

ALTER TABLE public.strategy_signal_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signals_owner ON public.strategy_signal_events;
CREATE POLICY signals_owner
  ON public.strategy_signal_events
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 12. strategy_execution_decisions (full audit trail)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_execution_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         uuid NOT NULL REFERENCES public.strategy_signal_events(id) ON DELETE CASCADE,
  deployment_id     uuid NOT NULL REFERENCES public.strategy_deployments(id),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  decision          text NOT NULL,
  reason_code       text,
  reason_details    text,
  proposed_order    jsonb,
  paper_order_id    uuid REFERENCES public.paper_orders(id),
  account_version   integer,
  quote_source      text,
  quote_timestamp   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_deployment
  ON public.strategy_execution_decisions(deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_signal
  ON public.strategy_execution_decisions(signal_id);
CREATE INDEX IF NOT EXISTS idx_decisions_user
  ON public.strategy_execution_decisions(user_id, created_at DESC);

ALTER TABLE public.strategy_execution_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decisions_owner ON public.strategy_execution_decisions;
CREATE POLICY decisions_owner
  ON public.strategy_execution_decisions
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 13. strategy_performance_snapshots (backtest summary per job)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_performance_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid NOT NULL REFERENCES public.strategy_backtest_jobs(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_version_id   uuid NOT NULL REFERENCES public.strategy_versions(id),
  symbol_or_universe    text NOT NULL,
  timeframe             text NOT NULL,
  from_date             timestamptz NOT NULL,
  to_date               timestamptz NOT NULL,
  total_return          numeric(12, 6),
  annualized_return     numeric(12, 6),
  max_drawdown          numeric(12, 6),
  sharpe                numeric(10, 4),
  sortino               numeric(10, 4),
  calmar                numeric(10, 4),
  win_rate              numeric(10, 6),
  profit_factor         numeric(12, 4),
  expectancy            numeric(12, 6),
  trade_count           integer,
  long_trade_count      integer,
  short_trade_count     integer,
  fees_paid             numeric(18, 4),
  slippage_cost         numeric(18, 4),
  net_profit            numeric(18, 4),
  exposure_percent      numeric(10, 6),
  benchmark_return      numeric(12, 6),
  alpha                 numeric(12, 6),
  data_hash             text,
  engine_version        text,
  execution_policy      text,
  intrabar_policy       text,
  fee_model             text,
  warnings              jsonb NOT NULL DEFAULT '[]',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_snapshots_job_unique
  ON public.strategy_performance_snapshots(job_id);
CREATE INDEX IF NOT EXISTS idx_perf_snapshots_user
  ON public.strategy_performance_snapshots(user_id, created_at DESC);

ALTER TABLE public.strategy_performance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS perf_snapshots_owner ON public.strategy_performance_snapshots;
CREATE POLICY perf_snapshots_owner
  ON public.strategy_performance_snapshots
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 14. strategy_replay_sessions (bar replay with isolated account)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_replay_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol              text NOT NULL,
  timeframe           text NOT NULL,
  start_timestamp     timestamptz NOT NULL,
  current_bar_timestamp timestamptz NOT NULL,
  bars_revealed       integer NOT NULL DEFAULT 0,
  initial_capital     numeric(18, 4) NOT NULL DEFAULT 1000000,
  current_equity      numeric(18, 4) NOT NULL DEFAULT 1000000,
  state               jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replay_sessions_user
  ON public.strategy_replay_sessions(user_id, status, created_at DESC);

ALTER TABLE public.strategy_replay_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replay_sessions_owner ON public.strategy_replay_sessions;
CREATE POLICY replay_sessions_owner
  ON public.strategy_replay_sessions
  USING (user_id = auth.uid());
