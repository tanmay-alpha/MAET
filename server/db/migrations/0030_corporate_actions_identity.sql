-- Migration 0030: one corporate_actions row per (symbol, action_type, ex_date)
-- The Yahoo corporate-action ingestion (server/modules/corporate-actions)
-- upserts on this key, so a re-run updates rows instead of adding copies.
-- Rows that already collide on the key keep the most recently ingested copy
-- (ties broken by id). Rows without an ex_date are left alone: NULLs never
-- collide under a unique index.

DELETE FROM public.corporate_actions older
USING public.corporate_actions newer
WHERE older.symbol = newer.symbol
  AND older.action_type = newer.action_type
  AND older.ex_date = newer.ex_date
  AND (older.ingested_at, older.id) < (newer.ingested_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS corporate_actions_symbol_type_ex_date_key
  ON public.corporate_actions(symbol, action_type, ex_date);
