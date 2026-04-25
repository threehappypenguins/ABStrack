-- Multiple time-ordered observations per (episode, preset line) for open-episode repeat passes.
-- Drop uniqueness that forced a single row per line; add non-unique indexes for lookups.
-- Intentional product rule: episode observations are append-only (new logs INSERT new rows; no
-- in-place overwrite of prior episode observations).
-- Triggers: block INSERT/UPDATE of episode-tied rows when episodes.ended_at is set.
--
-- Note: `database.types.ts` is generated after cloud apply; no hand-edits in repo.

-- ---------------------------------------------------------------------------
-- 1) episode_symptoms: drop partial unique (one row per episode + preset line)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.episode_symptoms_episode_id_preset_symptom_id_uidx;

CREATE INDEX IF NOT EXISTS episode_symptoms_episode_preset_line_idx
  ON public.episode_symptoms (episode_id, preset_symptom_id)
  WHERE
    episode_id IS NOT NULL
    AND preset_symptom_id IS NOT NULL;

COMMENT ON INDEX public.episode_symptoms_episode_preset_line_idx IS
  'Non-unique lookup for episode + preset line; multiple rows per pair are allowed (ordered by created_at, id).';

-- ---------------------------------------------------------------------------
-- 2) health_markers: drop unique (episode_id, preset_health_marker_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.health_markers
  DROP CONSTRAINT IF EXISTS health_markers_episode_preset_line_uidx;

CREATE INDEX IF NOT EXISTS health_markers_episode_preset_line_idx
  ON public.health_markers (episode_id, preset_health_marker_id)
  WHERE
    episode_id IS NOT NULL
    AND preset_health_marker_id IS NOT NULL;

COMMENT ON INDEX public.health_markers_episode_preset_line_idx IS
  'Non-unique lookup for episode + preset line; multiple rows per pair are allowed (ordered by recorded_at, id).';

-- food_diary_entries: no unique on episode; no change.

-- ---------------------------------------------------------------------------
-- 3) Triggers: no new or changed episode-tied data after the episode ends
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_episode_child_not_after_episode_end ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  old_ep_ended timestamptz;
  new_ep_ended timestamptz;
  old_eid uuid;
  new_eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_eid := OLD.episode_id;
    IF old_eid IS NOT NULL THEN
      SELECT
        e.ended_at INTO old_ep_ended
      FROM
        public.episodes e
      WHERE
        e.id = old_eid;
      IF old_ep_ended IS NOT NULL THEN
        RAISE EXCEPTION
          'This episode has ended. You cannot add or change entries for it.' USING
            ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  new_eid := NEW.episode_id;
  IF new_eid IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT
    e.ended_at INTO new_ep_ended
  FROM
    public.episodes e
  WHERE
    e.id = new_eid;
  IF new_ep_ended IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'This episode has ended. You cannot add or change entries for it.' USING
      ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.assert_episode_child_not_after_episode_end () IS
  'Blocks INSERT/UPDATE on episode_id–linked child rows when episodes.ended_at is not null. DELETE is allowed.';

DROP TRIGGER IF EXISTS episode_symptoms_block_after_end ON public.episode_symptoms;
CREATE TRIGGER episode_symptoms_block_after_end
  BEFORE INSERT OR UPDATE ON public.episode_symptoms
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_episode_child_not_after_episode_end ();

DROP TRIGGER IF EXISTS health_markers_block_after_end ON public.health_markers;
CREATE TRIGGER health_markers_block_after_end
  BEFORE INSERT OR UPDATE ON public.health_markers
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_episode_child_not_after_episode_end ();

DROP TRIGGER IF EXISTS food_diary_block_after_end ON public.food_diary_entries;
CREATE TRIGGER food_diary_block_after_end
  BEFORE INSERT OR UPDATE ON public.food_diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_episode_child_not_after_episode_end ();

-- ---------------------------------------------------------------------------
-- 4) Episodes: stamp post-marker boundary from server timestamp atomically
-- ---------------------------------------------------------------------------
-- When post_marker_step_completed_at is set (completion signal), stamp it from NEW.updated_at in
-- the same UPDATE statement so pass-boundary comparisons stay in DB time.
CREATE OR REPLACE FUNCTION public.stamp_episode_post_marker_boundary_from_updated_at ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF
    NEW.post_marker_step_completed_at IS NOT NULL
    AND NEW.post_marker_step_completed_at IS DISTINCT FROM OLD.post_marker_step_completed_at
  THEN
    NEW.post_marker_step_completed_at := NEW.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_episode_post_marker_boundary_from_updated_at () IS
  'When post_marker_step_completed_at changes, stamps it from NEW.updated_at so pass boundary and row update share one server timestamp.';

DROP TRIGGER IF EXISTS zz_episode_post_marker_boundary_stamp ON public.episodes;
CREATE TRIGGER zz_episode_post_marker_boundary_stamp
  BEFORE UPDATE ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_episode_post_marker_boundary_from_updated_at ();
