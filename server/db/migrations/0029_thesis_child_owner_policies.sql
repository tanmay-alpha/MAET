-- Migration 0029: owner SELECT policies for trade thesis child tables
-- 0015 enabled RLS on thesis_signals, thesis_snapshots and thesis_order_links
-- but created no policies, so signed-in clients could never read their own
-- rows while the parent tables (trade_theses, trade_reviews) got owner SELECT
-- policies in 0028. The child tables carry no user_id; ownership is derived
-- from the parent trade_theses row. Same shape as 0028: owner SELECT for
-- authenticated, no client writes, nothing for anon. The backend connects as
-- the table owner and is unaffected.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['thesis_signals', 'thesis_snapshots', 'thesis_order_links']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS ('
        'SELECT 1 FROM public.trade_theses tt WHERE tt.id = %I.thesis_id AND tt.user_id = auth.uid()))',
      t || '_owner_select', t, t
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
