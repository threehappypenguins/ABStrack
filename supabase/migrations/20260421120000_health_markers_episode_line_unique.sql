-- health_markers: generated key columns + episode-bound rows keyed by `preset_health_markers.id`
-- (with `episode_id`) so multiple template lines with the same `marker_kind` stay distinct.
-- One measurement per preset line per episode; wellness rows keep `episode_id` / `preset_health_marker_id` null.
--
-- Custom name/unit handling is two-layer (do not conflate when debugging upserts / backfill matching):
-- - Application writes: `normalizeCustomField` in `episode-health-marker-data.ts` trims strings and
--   stores blank/whitespace-only as SQL NULL (so inserts stay canonical from the client).
-- - Database: `custom_name_key` / `custom_unit_key` are GENERATED with `coalesce(custom_*, '')` so NULL
--   and empty string compare the same for template/marker matching and uniqueness in SQL.
--
-- DATA SAFETY (episode-bound rows after backfill):
-- Rows with episode_id set but no matching preset_health_markers line (e.g. episode missing
-- health_marker_preset_id, template changed, or marker_kind/custom fields no longer on the preset)
-- cannot satisfy the new CHECK (episode_id ⇒ preset_health_marker_id). This migration does NOT
-- silently DELETE those rows: it FAILS so you can inspect, fix templates or rows, or remove them
-- deliberately, then re-run `db push`. Duplicate (episode_id, preset_health_marker_id) rows are
-- still deduplicated below (keep newest); note that in PR/release notes if that matters for audits.
--
-- PRESET LINE DELETES (`preset_health_markers`):
-- `health_markers.preset_health_marker_id` uses ON DELETE RESTRICT so episode measurements keep a
-- valid template line id (CASCADE would drop patient data; SET NULL conflicts with the CHECK that
-- episode-bound rows require a preset line). Editors that call DELETE on a line therefore get a
-- foreign-key error once any episode row references that line—expected; UX should show a clear
-- message (see `mapSupabaseErrorToPresetDataError` for `health_markers_preset_health_marker_id_fkey`).
-- Longer-term options if product needs “remove line from template” anyway: soft-delete/archived
-- preset lines, or admin tools that reassign measurements—not handled in this migration.
--
-- Locking: this file runs DDL + backfill + constraints in one transaction (one migration file).
-- That can block `health_markers` for the full duration on busy or very large tables; plan a window
-- if needed. Splitting into multiple migration files would shorten per-step locks but adds churn.

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

-- RESTRICT (not SET NULL): episode-bound rows must keep a non-null preset line id per CHECK below;
-- nulling the FK on preset line delete would violate that constraint.
ALTER TABLE public.health_markers
  ADD COLUMN IF NOT EXISTS preset_health_marker_id uuid REFERENCES public.preset_health_markers (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.health_markers.preset_health_marker_id IS
  'Preset line (`preset_health_markers.id`) for episode-bound rows; paired with episode_id for upsert. NULL for wellness / non-episode rows. Deleting a referenced preset line is blocked while episode markers still reference it.';

-- Backfill: match episode template + line signature; pick one preset line when several match (lowest sort_order).
-- Use a correlated scalar subquery (not FROM LATERAL): Postgres rejects referencing the UPDATE target `hm`
-- inside a LATERAL join tree (SQLSTATE 42P10).
UPDATE public.health_markers hm
SET preset_health_marker_id = (
  SELECT phm.id
  FROM public.episodes e
  JOIN public.preset_health_markers phm
    ON phm.preset_id = e.health_marker_preset_id
   AND phm.marker_kind = hm.marker_kind
   AND coalesce(phm.custom_name, '') = coalesce(hm.custom_name, '')
   AND coalesce(phm.custom_unit, '') = coalesce(hm.custom_unit, '')
  WHERE e.id = hm.episode_id
  ORDER BY phm.sort_order ASC, phm.id ASC
  LIMIT 1
)
WHERE hm.episode_id IS NOT NULL;

-- Fail fast if any episode-bound row is still unmappable (no silent delete).
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*)::integer
  INTO orphan_count
  FROM public.health_markers
  WHERE episode_id IS NOT NULL
    AND preset_health_marker_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot complete health_markers migration: % episode-bound row(s) have no matching preset_health_markers line after backfill (check episodes.health_marker_preset_id, marker_kind, custom_name, custom_unit on the episode template). Repair or delete those health_markers rows, then re-run. Example: SELECT id, user_id, episode_id, marker_kind FROM public.health_markers WHERE episode_id IS NOT NULL AND preset_health_marker_id IS NULL;',
      orphan_count;
  END IF;
END $$;

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

-- Full UNIQUE (not partial): PostgREST upsert uses `on_conflict=episode_id,preset_health_marker_id`
-- and cannot target a partial index predicate. NULLs are distinct, so wellness rows
-- (episode_id / preset_health_marker_id null) are not forced unique by this constraint.
-- Drop CONSTRAINT before INDEX: a UNIQUE constraint owns its index; dropping the index first fails.
ALTER TABLE public.health_markers
  DROP CONSTRAINT IF EXISTS health_markers_episode_preset_line_uidx;

DROP INDEX IF EXISTS public.health_markers_episode_preset_line_uidx;

ALTER TABLE public.health_markers
  ADD CONSTRAINT health_markers_episode_preset_line_uidx UNIQUE (episode_id, preset_health_marker_id);

COMMENT ON CONSTRAINT health_markers_episode_preset_line_uidx ON public.health_markers IS
  'One row per (episode, preset line); same-kind template lines stay distinct. Wellness rows may repeat (NULL distinctness).';

ALTER TABLE public.health_markers
  DROP CONSTRAINT IF EXISTS health_markers_episode_requires_preset_line;

ALTER TABLE public.health_markers
  ADD CONSTRAINT health_markers_episode_requires_preset_line CHECK (
    episode_id IS NULL OR preset_health_marker_id IS NOT NULL
  );

COMMIT;
