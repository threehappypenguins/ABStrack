-- health_markers: generated key columns + episode-bound rows keyed by `preset_health_markers.id`
-- (with `episode_id`) so multiple template lines with the same `marker_kind` stay distinct.
-- One measurement per preset line per episode; wellness rows keep `episode_id` / `preset_health_marker_id` null.
--
-- Generated keys normalize NULL custom fields to '' (see packages/supabase normalizeCustomField).

BEGIN;

LOCK TABLE public.health_markers IN EXCLUSIVE MODE;

ALTER TABLE public.health_markers
  ADD COLUMN IF NOT EXISTS custom_name_key text
    GENERATED ALWAYS AS (coalesce(custom_name, '')) STORED,
  ADD COLUMN IF NOT EXISTS custom_unit_key text
    GENERATED ALWAYS AS (coalesce(custom_unit, '')) STORED;

COMMENT ON COLUMN public.health_markers.custom_name_key IS
  'Generated from custom_name; do not insert or update.';
COMMENT ON COLUMN public.health_markers.custom_unit_key IS
  'Generated from custom_unit; do not insert or update.';

ALTER TABLE public.health_markers
  ADD COLUMN IF NOT EXISTS preset_health_marker_id uuid REFERENCES public.preset_health_markers (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.health_markers.preset_health_marker_id IS
  'Preset line (`preset_health_markers.id`) for episode-bound rows; paired with episode_id for upsert. NULL for wellness / non-episode rows.';

-- Backfill: match episode template + line signature; pick one preset line when several match (lowest sort_order).
UPDATE public.health_markers hm
SET preset_health_marker_id = x.phm_id
FROM LATERAL (
  SELECT phm.id AS phm_id
  FROM public.episodes e
  JOIN public.preset_health_markers phm
    ON phm.preset_id = e.health_marker_preset_id
   AND phm.marker_kind = hm.marker_kind
   AND coalesce(phm.custom_name, '') = coalesce(hm.custom_name, '')
   AND coalesce(phm.custom_unit, '') = coalesce(hm.custom_unit, '')
  WHERE e.id = hm.episode_id
  ORDER BY phm.sort_order ASC, phm.id ASC
  LIMIT 1
) x
WHERE hm.episode_id IS NOT NULL;

DELETE FROM public.health_markers hm
WHERE hm.episode_id IS NOT NULL
  AND hm.preset_health_marker_id IS NULL;

DELETE FROM public.health_markers hm
WHERE hm.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY episode_id, preset_health_marker_id
        ORDER BY recorded_at DESC, created_at DESC, id DESC
      ) AS rn
    FROM public.health_markers
    WHERE episode_id IS NOT NULL
      AND preset_health_marker_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS health_markers_episode_preset_line_uidx
  ON public.health_markers (episode_id, preset_health_marker_id)
  WHERE episode_id IS NOT NULL
    AND preset_health_marker_id IS NOT NULL;

COMMENT ON INDEX public.health_markers_episode_preset_line_uidx IS
  'One measurement per preset line per episode; allows multiple same-kind lines when the template has separate rows.';

ALTER TABLE public.health_markers
  DROP CONSTRAINT IF EXISTS health_markers_episode_requires_preset_line;

ALTER TABLE public.health_markers
  ADD CONSTRAINT health_markers_episode_requires_preset_line CHECK (
    episode_id IS NULL OR preset_health_marker_id IS NOT NULL
  );

COMMIT;
