-- Episode-scoped health marker lines: at most one row per
-- (episode_id, marker_kind, custom_name, custom_unit) signature.
-- Enables atomic upserts from the client without read-then-write races.
--
-- Generated keys normalize NULL custom fields to '' so uniqueness matches app logic
-- (see packages/supabase episode-health-marker-data normalizeCustomField).

ALTER TABLE public.health_markers
  ADD COLUMN IF NOT EXISTS custom_name_key text
    GENERATED ALWAYS AS (coalesce(custom_name, '')) STORED,
  ADD COLUMN IF NOT EXISTS custom_unit_key text
    GENERATED ALWAYS AS (coalesce(custom_unit, '')) STORED;

COMMENT ON COLUMN public.health_markers.custom_name_key IS
  'Generated from custom_name for unique index and upsert onConflict; do not insert or update.';
COMMENT ON COLUMN public.health_markers.custom_unit_key IS
  'Generated from custom_unit for unique index and upsert onConflict; do not insert or update.';

-- Remove duplicate episode-bound rows, keeping the newest measurement per signature.
DELETE FROM public.health_markers hm
WHERE hm.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          episode_id,
          marker_kind,
          coalesce(custom_name, ''),
          coalesce(custom_unit, '')
        ORDER BY recorded_at DESC, created_at DESC, id DESC
      ) AS rn
    FROM public.health_markers
    WHERE episode_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS health_markers_episode_marker_line_uidx
  ON public.health_markers (
    episode_id,
    marker_kind,
    custom_name_key,
    custom_unit_key
  )
  WHERE episode_id IS NOT NULL;

COMMENT ON INDEX public.health_markers_episode_marker_line_uidx IS
  'One row per episode + preset line signature (marker_kind + custom fields); wellness rows (episode_id NULL) are excluded.';
