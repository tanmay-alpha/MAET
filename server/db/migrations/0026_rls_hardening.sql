-- Migration 0026: RLS hardening
-- alerts (0013), backtest_presets (0014), technical_snapshots (0021) and
-- universe_membership (0022) were created without row level security. On
-- Supabase the default privileges grant every public table to anon and
-- authenticated, so these tables were readable/writable through PostgREST by
-- any holder of the anon key. The backend uses the service role and is not
-- affected by RLS.

ALTER TABLE IF EXISTS public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.backtest_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.technical_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.universe_membership ENABLE ROW LEVEL SECURITY;

-- User-owned tables: owner-only access, same shape as the 0013 policies.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['alerts', 'backtest_presets']) LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
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

-- Backend-only market data: no client reads them through the Supabase client,
-- so remove all client-role privileges (pattern from 0017).
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['technical_snapshots', 'universe_membership']) LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    FOR r IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
