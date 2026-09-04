-- Preserve every legacy symbol in a dedicated canonical list before retiring the duplicate table.
DO $migration$
BEGIN
  IF to_regclass('public.watchlist') IS NOT NULL THEN
    INSERT INTO public.user_watchlists (
      user_id,
      name,
      description,
      is_pinned,
      position
    )
    SELECT
      legacy_users.user_id,
      'Imported Watchlist',
      'Migrated from legacy watchlist',
      false,
      COALESCE((
        SELECT MAX(existing.position) + 1
        FROM public.user_watchlists existing
        WHERE existing.user_id = legacy_users.user_id
      ), 0)
    FROM (
      SELECT DISTINCT user_id
      FROM public.watchlist
    ) legacy_users
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_watchlists existing_import
      WHERE existing_import.user_id = legacy_users.user_id
        AND lower(existing_import.name) = lower('Imported Watchlist')
    );

    WITH imported_targets AS (
      SELECT DISTINCT ON (candidate.user_id)
        candidate.user_id,
        candidate.id AS watchlist_id
      FROM public.user_watchlists candidate
      INNER JOIN (
        SELECT DISTINCT user_id
        FROM public.watchlist
      ) legacy_users ON legacy_users.user_id = candidate.user_id
      WHERE lower(candidate.name) = lower('Imported Watchlist')
      ORDER BY candidate.user_id, candidate.created_at ASC, candidate.id ASC
    ),
    existing_positions AS (
      SELECT
        target.watchlist_id,
        COALESCE(MAX(existing_item.position), -1) AS max_position
      FROM imported_targets target
      LEFT JOIN public.watchlist_items existing_item
        ON existing_item.watchlist_id = target.watchlist_id
      GROUP BY target.watchlist_id
    ),
    ordered_legacy_items AS (
      SELECT
        target.watchlist_id,
        legacy.user_id,
        legacy.symbol,
        legacy.exchange,
        legacy.created_at,
        (
          positions.max_position + ROW_NUMBER() OVER (
            PARTITION BY target.watchlist_id
            ORDER BY legacy.created_at ASC, legacy.symbol ASC, legacy.exchange ASC
          )
        )::integer AS position
      FROM public.watchlist legacy
      INNER JOIN imported_targets target ON target.user_id = legacy.user_id
      INNER JOIN existing_positions positions ON positions.watchlist_id = target.watchlist_id
    )
    INSERT INTO public.watchlist_items (
      watchlist_id,
      user_id,
      symbol,
      exchange,
      position,
      created_at
    )
    SELECT
      watchlist_id,
      user_id,
      symbol,
      exchange,
      position,
      created_at
    FROM ordered_legacy_items
    ORDER BY watchlist_id, position
    ON CONFLICT (watchlist_id, symbol, exchange) DO NOTHING;

    DROP TABLE public.watchlist;
  END IF;
END
$migration$;
