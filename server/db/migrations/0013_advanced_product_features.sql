-- =============================================================================
-- Migration 0013: Advanced Product Features
-- Cloud workspace, server alert engine, notifications, research notes,
-- portfolio snapshots, feature preferences, and DLQ.
-- =============================================================================

-- --- User Watchlists (named, more than one per user) ---

CREATE TABLE IF NOT EXISTS public.user_watchlists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  is_pinned     boolean NOT NULL DEFAULT false,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_watchlists_name_length CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_watchlists_user_name_unique
  ON public.user_watchlists(user_id, lower(name));

CREATE INDEX IF NOT EXISTS user_watchlists_user_idx
  ON public.user_watchlists(user_id, position);

-- --- Watchlist Items (ordered items within a watchlist) ---

CREATE TABLE IF NOT EXISTS public.watchlist_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id    uuid NOT NULL REFERENCES public.user_watchlists(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  exchange        text NOT NULL DEFAULT 'NSE',
  note            text,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_items_exchange_whitelist CHECK (exchange IN ('NSE','BSE')),
  CONSTRAINT watchlist_items_symbol_format CHECK (symbol ~ '^[A-Z0-9&\-\.]{1,20}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS watchlist_items_unique
  ON public.watchlist_items(watchlist_id, symbol, exchange);

CREATE INDEX IF NOT EXISTS watchlist_items_user_idx
  ON public.watchlist_items(user_id, position);

-- --- Saved Screener Definitions (named, shareable within user) ---

CREATE TABLE IF NOT EXISTS public.saved_screener_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  universe        text NOT NULL DEFAULT 'NSE',
  criteria        jsonb NOT NULL,
  is_pinned       boolean NOT NULL DEFAULT false,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_run_at     timestamptz,
  CONSTRAINT saved_screeners_name_length CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_screeners_user_name_unique
  ON public.saved_screener_definitions(user_id, lower(name))
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS saved_screeners_user_pinned_idx
  ON public.saved_screener_definitions(user_id, is_pinned, updated_at);

-- --- Saved Screener Runs (execution history) ---

CREATE TABLE IF NOT EXISTS public.saved_screener_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  screener_id     uuid NOT NULL REFERENCES public.saved_screener_definitions(id) ON DELETE CASCADE,
  run_started_at  timestamptz NOT NULL DEFAULT now(),
  run_completed_at timestamptz,
  match_count     integer,
  symbols         text[] NOT NULL DEFAULT '{}',
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_screener_runs_user_idx
  ON public.saved_screener_runs(user_id, run_started_at DESC);

CREATE INDEX IF NOT EXISTS saved_screener_runs_screener_idx
  ON public.saved_screener_runs(screener_id, run_started_at DESC);

-- --- Alerts (user-defined alert definitions) ---

CREATE TABLE IF NOT EXISTS public.alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  exchange        text NOT NULL DEFAULT 'NSE',
  type            text NOT NULL,
  condition       text NOT NULL,
  target          numeric(18, 4) NOT NULL,
  message         text,
  triggered       boolean NOT NULL DEFAULT false,
  triggered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_user_idx
  ON public.alerts(user_id);

CREATE INDEX IF NOT EXISTS alerts_symbol_idx
  ON public.alerts(symbol);

-- --- Alert Events (server-side trigger history) ---

CREATE TABLE IF NOT EXISTS public.alert_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  exchange        text NOT NULL DEFAULT 'NSE',
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  observed_value  numeric(24, 4),
  target_value    numeric(24, 4) NOT NULL,
  condition_type  text NOT NULL,
  message         text,
  provider        text NOT NULL,
  provider_timestamp timestamptz,
  fingerprint     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_events_fingerprint_nonempty CHECK (char_length(fingerprint) >= 8)
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_events_fingerprint_unique
  ON public.alert_events(alert_id, fingerprint);

CREATE INDEX IF NOT EXISTS alert_events_user_triggered_idx
  ON public.alert_events(user_id, triggered_at DESC);

-- --- User Notifications (in-app notification centre) ---

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  title           text NOT NULL,
  body            text,
  symbol          text,
  alert_id        uuid REFERENCES public.alerts(id) ON DELETE SET NULL,
  alert_event_id  uuid REFERENCES public.alert_events(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_kind_whitelist CHECK (
    kind IN (
      'alert_triggered',
      'alert_enabled',
      'alert_disabled',
      'system',
      'data_quality',
      'paper_trade'
    )
  ),
  CONSTRAINT user_notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON public.user_notifications(user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON public.user_notifications(user_id, created_at DESC);

-- --- Portfolio Snapshots (daily state for analytics) ---

CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  snapshot_date   date NOT NULL,
  cash_balance    numeric(18, 4) NOT NULL,
  total_equity    numeric(18, 4) NOT NULL,
  margin_used     numeric(18, 4) NOT NULL DEFAULT 0,
  unrealized_pnl  numeric(18, 4) NOT NULL DEFAULT 0,
  realized_pnl    numeric(18, 4) NOT NULL DEFAULT 0,
  positions_count integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_snapshots_date_unique UNIQUE (user_id, snapshot_date),
  CONSTRAINT portfolio_snapshots_date_valid CHECK (snapshot_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_date_idx
  ON public.portfolio_snapshots(user_id, snapshot_date DESC);

-- --- Research Notes (user research annotations) ---

CREATE TABLE IF NOT EXISTS public.research_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  exchange        text NOT NULL DEFAULT 'NSE',
  title           text NOT NULL,
  body            text NOT NULL,
  tags            text[] NOT NULL DEFAULT '{}',
  event_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_notes_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT research_notes_exchange_whitelist CHECK (exchange IN ('NSE','BSE'))
);

CREATE INDEX IF NOT EXISTS research_notes_user_symbol_idx
  ON public.research_notes(user_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS research_notes_user_created_idx
  ON public.research_notes(user_id, created_at DESC);

-- --- Feature Preferences (per-user feature enablement overrides) ---

CREATE TABLE IF NOT EXISTS public.feature_preferences (
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  capability      text NOT NULL,
  enabled         boolean NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability)
);

-- --- Ingestion Runs (batches for QA) ---

-- Drop and recreate to ensure consistent schema regardless of prior state.
DROP TABLE IF EXISTS public.ingestion_runs CASCADE;

CREATE TABLE public.ingestion_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        text NOT NULL,
  source          text NOT NULL,
  data_type       text NOT NULL,
  operation       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,
  attempted       integer NOT NULL DEFAULT 0,
  inserted        integer NOT NULL DEFAULT 0,
  updated         integer NOT NULL DEFAULT 0,
  failed          integer NOT NULL DEFAULT 0,
  retry_count     integer NOT NULL DEFAULT 0,
  error_summary   text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_runs_status_whitelist CHECK (
    status IN ('pending','running','succeeded','failed','partial')
  )
);

CREATE INDEX IF NOT EXISTS ingestion_runs_source_type_idx
  ON public.ingestion_runs(source, data_type);

CREATE INDEX IF NOT EXISTS ingestion_runs_status_started_idx
  ON public.ingestion_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS ingestion_runs_batch_idx
  ON public.ingestion_runs(batch_id);

-- --- Dead Letter Queue (failed ingestion records) ---

DROP TABLE IF EXISTS public.dead_letter_queue CASCADE;

CREATE TABLE public.dead_letter_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,
  data_type       text NOT NULL,
  batch_id        text,
  payload         jsonb NOT NULL,
  error_message   text NOT NULL,
  retry_count     integer NOT NULL DEFAULT 0,
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dlq_unresolved_idx
  ON public.dead_letter_queue(created_at DESC)
  WHERE resolved_at IS NULL;

-- --- Saved Comparisons (pin favourite comparisons) ---

CREATE TABLE IF NOT EXISTS public.saved_comparisons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  symbols         text[] NOT NULL,
  metric_keys     text[] NOT NULL DEFAULT '{}',
  is_pinned       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_comparisons_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT saved_comparisons_symbols_limit CHECK (array_length(symbols, 1) BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS saved_comparisons_user_idx
  ON public.saved_comparisons(user_id, updated_at DESC);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE public.user_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_screener_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_screener_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_comparisons ENABLE ROW LEVEL SECURITY;

-- Policy helper: a user can only see their own rows.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'user_watchlists',
      'watchlist_items',
      'saved_screener_definitions',
      'saved_screener_runs',
      'alert_events',
      'user_notifications',
      'portfolio_snapshots',
      'research_notes',
      'feature_preferences',
      'saved_comparisons'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner_modify ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_owner_select ON public.%I FOR SELECT USING (user_id = auth.uid())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_owner_modify ON public.%I FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
      t, t
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- ingestion_runs and dead_letter_queue are admin-only via service role.
-- No RLS user policies; only backend service role can read/write.
-- -----------------------------------------------------------------------------

ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;

-- No policies: no user can read/write these tables directly. The backend uses
-- service role for ingestion operations.

-- -----------------------------------------------------------------------------
-- updated_at triggers for tables that need them
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'user_watchlists',
      'saved_screener_definitions',
      'research_notes',
      'feature_preferences',
      'saved_comparisons'
    ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      t, t
    );
  END LOOP;
END $$;
