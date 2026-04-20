-- At most one active (ended_at IS NULL) episode per user. Deduplicate existing rows first so the
-- index can be created on existing databases.

-- Explicit transaction: LOCK TABLE requires a transaction block (SQLSTATE 25P01 if applied
-- statement-by-statement). The lock blocks concurrent inserts on `episodes` so a new active row
-- cannot appear between the dedupe UPDATE and CREATE UNIQUE INDEX.
BEGIN;

-- Hold an exclusive lock on the table for this transaction so no concurrent writer can create a
-- second active episode (ended_at IS NULL) for the same user between deduplication and index
-- creation.
LOCK TABLE public.episodes IN EXCLUSIVE MODE;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY
        started_at DESC,
        id DESC
    ) AS rn
  FROM
    public.episodes
  WHERE
    ended_at IS NULL
)
UPDATE public.episodes e
SET
  ended_at = now()
FROM
  ranked r
WHERE
  e.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS episodes_one_active_per_user_idx ON public.episodes (user_id)
WHERE
  ended_at IS NULL;

COMMENT ON INDEX public.episodes_one_active_per_user_idx IS 'Ensures at most one open episode per user; aligns with app-layer start guards.';

COMMIT;
