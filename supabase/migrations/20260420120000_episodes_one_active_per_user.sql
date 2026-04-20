-- At most one active (ended_at IS NULL) episode per user. Deduplicate existing rows first so the
-- index can be created on existing databases.

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

CREATE UNIQUE INDEX episodes_one_active_per_user_idx ON public.episodes (user_id)
WHERE
  ended_at IS NULL;

COMMENT ON INDEX public.episodes_one_active_per_user_idx IS 'Ensures at most one open episode per user; aligns with app-layer start guards.';
