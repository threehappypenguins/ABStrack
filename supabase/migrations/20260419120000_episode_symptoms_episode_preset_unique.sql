-- One answer row per preset symptom line within an episode (prevents duplicates and races).
-- Partial index: only rows tied to an episode (episode_id IS NOT NULL) with a preset line id.
-- Ad-hoc / NULL episode_id rows are out of scope for this uniqueness rule.

-- Hold an exclusive lock for the whole migration transaction so no concurrent writer can insert a
-- duplicate (episode_id, preset_symptom_id) between the DELETE and CREATE UNIQUE INDEX.
LOCK TABLE public.episode_symptoms IN EXCLUSIVE MODE;

-- Remove duplicate (episode_id, preset_symptom_id) rows if any exist before creating the index.
-- Keep the newest row per pair so we do not discard the latest user-entered answer (older rows are races/legacy).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY episode_id, preset_symptom_id
      ORDER BY
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.episode_symptoms
  WHERE
    episode_id IS NOT NULL
    AND preset_symptom_id IS NOT NULL
)
DELETE FROM public.episode_symptoms es
USING ranked r
WHERE
  es.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS episode_symptoms_episode_id_preset_symptom_id_uidx
  ON public.episode_symptoms (episode_id, preset_symptom_id)
  WHERE
    episode_id IS NOT NULL
    AND preset_symptom_id IS NOT NULL;

COMMENT ON INDEX public.episode_symptoms_episode_id_preset_symptom_id_uidx IS 'At most one logged answer per preset symptom step per episode (episode_symptoms upsert).';
