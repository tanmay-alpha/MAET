-- Migration 0028: client roles get read-only access to user-owned tables
-- 0013, 0015, 0016 and 0026 gave user-owned tables owner policies without a
-- command restriction (FOR ALL, or no FOR clause, which means ALL). Supabase
-- grants every public table to anon/authenticated by default and the browser
-- ships the anon key, so a signed-in user could INSERT/UPDATE/DELETE their own
-- rows through PostgREST and bypass every API-side rule (job caps, the sweep
-- combination limit, MAX_ALERTS_PER_USER, kill switches, status transitions).
--
-- The frontend never talks to PostgREST (it only uses Supabase Auth); all
-- writes go through the backend, which connects as the table owner and is not
-- subject to RLS or these grants. Same shape as the paper tables in 0011:
-- owner SELECT policy for authenticated, no client writes, nothing for anon.

DO $$
DECLARE
  t text;
  spec text[];
BEGIN
  -- [table, existing unrestricted policy, replacement SELECT policy]
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    -- 0013
    ['user_watchlists', 'user_watchlists_owner_modify', 'user_watchlists_owner_select'],
    ['watchlist_items', 'watchlist_items_owner_modify', 'watchlist_items_owner_select'],
    ['saved_screener_definitions', 'saved_screener_definitions_owner_modify', 'saved_screener_definitions_owner_select'],
    ['saved_screener_runs', 'saved_screener_runs_owner_modify', 'saved_screener_runs_owner_select'],
    ['alert_events', 'alert_events_owner_modify', 'alert_events_owner_select'],
    ['user_notifications', 'user_notifications_owner_modify', 'user_notifications_owner_select'],
    ['portfolio_snapshots', 'portfolio_snapshots_owner_modify', 'portfolio_snapshots_owner_select'],
    ['research_notes', 'research_notes_owner_modify', 'research_notes_owner_select'],
    ['feature_preferences', 'feature_preferences_owner_modify', 'feature_preferences_owner_select'],
    ['saved_comparisons', 'saved_comparisons_owner_modify', 'saved_comparisons_owner_select'],
    -- 0026
    ['alerts', 'alerts_owner_modify', 'alerts_owner_select'],
    ['backtest_presets', 'backtest_presets_owner_modify', 'backtest_presets_owner_select'],
    -- 0015
    ['chart_workspaces', 'chart_workspaces_tenant_isolation', 'chart_workspaces_owner_select'],
    ['chart_panes', 'chart_panes_tenant_isolation', 'chart_panes_owner_select'],
    ['chart_drawings', 'chart_drawings_tenant_isolation', 'chart_drawings_owner_select'],
    ['indicator_templates', 'indicator_templates_tenant_isolation', 'indicator_templates_owner_select'],
    ['trade_theses', 'trade_theses_tenant_isolation', 'trade_theses_owner_select'],
    ['trade_reviews', 'trade_reviews_tenant_isolation', 'trade_reviews_owner_select'],
    -- 0016
    ['strategy_definitions', 'strategy_definitions_owner', 'strategy_definitions_owner_select'],
    ['strategy_versions', 'strategy_versions_owner', 'strategy_versions_owner_select'],
    ['strategy_backtest_jobs', 'backtest_jobs_owner', 'backtest_jobs_owner_select'],
    ['strategy_backtest_trades', 'backtest_trades_owner', 'backtest_trades_owner_select'],
    ['strategy_equity_points', 'equity_points_owner', 'equity_points_owner_select'],
    ['strategy_parameter_sweeps', 'sweeps_owner', 'sweeps_owner_select'],
    ['strategy_sweep_results', 'sweep_results_owner', 'sweep_results_owner_select'],
    ['strategy_walk_forward_runs', 'wf_runs_owner', 'wf_runs_owner_select'],
    ['strategy_walk_forward_windows', 'wf_windows_owner', 'wf_windows_owner_select'],
    ['strategy_deployments', 'deployments_owner', 'deployments_owner_select'],
    ['strategy_signal_events', 'signals_owner', 'signals_owner_select'],
    ['strategy_execution_decisions', 'decisions_owner', 'decisions_owner_select'],
    ['strategy_performance_snapshots', 'perf_snapshots_owner', 'perf_snapshots_owner_select'],
    ['strategy_replay_sessions', 'replay_sessions_owner', 'replay_sessions_owner_select']
  ]
  LOOP
    t := spec[1];
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec[2], t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec[3], t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())',
      spec[3], t
    );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated',
        t
      );
    END IF;
  END LOOP;
END $$;
