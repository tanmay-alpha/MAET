-- =============================================================================
-- Migration 0012: Enforce Database-Level Immutability on Fills and Ledger
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_paper_fills_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('maet.allow_history_mutation', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Table paper_fills is append-only. UPDATE and DELETE operations are forbidden.'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_paper_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('maet.allow_history_mutation', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Table paper_ledger_entries is append-only. UPDATE and DELETE operations are forbidden.'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_paper_fills_mutation') THEN
    CREATE TRIGGER trg_prevent_paper_fills_mutation
      BEFORE UPDATE OR DELETE ON public.paper_fills
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_paper_fills_mutation();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_paper_ledger_mutation') THEN
    CREATE TRIGGER trg_prevent_paper_ledger_mutation
      BEFORE UPDATE OR DELETE ON public.paper_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_paper_ledger_mutation();
  END IF;
END $$;
