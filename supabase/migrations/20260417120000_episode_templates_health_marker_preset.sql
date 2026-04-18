-- episodes: optional per-episode health_marker_preset_id (same-owner pattern as symptom_preset_id).
-- episode_templates: each row pairs exactly one symptom preset with one health marker preset (both columns NOT NULL; invalid to omit either). ON DELETE CASCADE removes the template if either referenced preset is deleted.
-- RLS (PRD Authorized access): patient CRUD on own user_id; caretaker CRUD when caretaker_access links (same effective access as patient for these rows); practitioner SELECT only when practitioner_access + MFA rules apply—no write policies for practitioners (same policy shape as symptom_presets / health_marker_presets).

-- ---------------------------------------------------------------------------
-- episodes.health_marker_preset_id
-- ---------------------------------------------------------------------------
-- Idempotent: column may already exist if a prior push applied this section but migration history was repaired / out of sync.
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS health_marker_preset_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      pg_constraint
    WHERE
      conname = 'episodes_health_marker_preset_id_fk') THEN
    ALTER TABLE public.episodes
      ADD CONSTRAINT episodes_health_marker_preset_id_fk FOREIGN KEY (health_marker_preset_id)
        REFERENCES public.health_marker_presets (id)
        ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.episodes.health_marker_preset_id IS 'Optional FK to health_marker_presets.id; ON DELETE SET NULL clears only this column. Same-owner vs user_id is enforced by trigger episode_preset_owners.';

COMMENT ON COLUMN public.episodes.symptom_preset_id IS 'Optional FK to symptom_presets.id; ON DELETE SET NULL clears only this column. Same-owner vs user_id is enforced by trigger episode_preset_owners (composite FK SET NULL would null user_id).';

-- ---------------------------------------------------------------------------
-- Replace symptom-only trigger with combined preset-owner enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_episode_preset_owners ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.symptom_preset_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.symptom_presets s
      WHERE
        s.id = NEW.symptom_preset_id
        AND s.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'episodes.symptom_preset_id must reference a preset owned by user_id';
    END IF;
  END IF;
  IF NEW.health_marker_preset_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.health_marker_presets h
      WHERE
        h.id = NEW.health_marker_preset_id
        AND h.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'episodes.health_marker_preset_id must reference a preset owned by user_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_episode_preset_owners () IS 'Ensures episode symptom_preset_id and health_marker_preset_id reference presets owned by episodes.user_id.';

DROP TRIGGER IF EXISTS episode_symptom_preset_owner ON public.episodes;

DROP FUNCTION IF EXISTS public.enforce_episode_symptom_preset_owner ();

DROP TRIGGER IF EXISTS episode_preset_owners ON public.episodes;

CREATE TRIGGER episode_preset_owners
  BEFORE INSERT OR UPDATE OF symptom_preset_id, health_marker_preset_id, user_id ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_episode_preset_owners ();

-- ---------------------------------------------------------------------------
-- episode_templates — NOT NULL preset pair; CASCADE on preset delete; RLS mirrors symptom_presets (patient + caretaker write; practitioner read)
-- ---------------------------------------------------------------------------
-- IF NOT EXISTS: table may already exist if a prior run failed after CREATE TABLE but before migration history was recorded.
CREATE TABLE IF NOT EXISTS public.episode_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  symptom_preset_id uuid NOT NULL,
  health_marker_preset_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT episode_templates_symptom_preset_id_fk FOREIGN KEY (symptom_preset_id)
    REFERENCES public.symptom_presets (id)
    ON DELETE CASCADE,
  CONSTRAINT episode_templates_health_marker_preset_id_fk FOREIGN KEY (health_marker_preset_id)
    REFERENCES public.health_marker_presets (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS episode_templates_user_idx ON public.episode_templates (user_id);

COMMENT ON TABLE public.episode_templates IS 'Named template: required symptom + health-marker preset pair for episode starts (both FKs NOT NULL). Deleting either preset CASCADE-deletes the template. RLS: patient and linked caretaker read/write; practitioner read-only with grant (PRD); user_id immutability via phi_user_id_immutable.';
COMMENT ON COLUMN public.episode_templates.symptom_preset_id IS 'Required FK to symptom_presets.id; ON DELETE CASCADE removes this template if the symptom preset is deleted. Same-owner vs user_id is enforced by trigger episode_template_preset_owners.';
COMMENT ON COLUMN public.episode_templates.health_marker_preset_id IS 'Required FK to health_marker_presets.id; ON DELETE CASCADE removes this template if the health-marker preset is deleted. Same-owner vs user_id is enforced by trigger episode_template_preset_owners.';

CREATE OR REPLACE FUNCTION public.enforce_episode_template_preset_owners ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets s
    WHERE
      s.id = NEW.symptom_preset_id
      AND s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'episode_templates.symptom_preset_id must reference a preset owned by user_id';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets h
    WHERE
      h.id = NEW.health_marker_preset_id
      AND h.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'episode_templates.health_marker_preset_id must reference a preset owned by user_id';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_episode_template_preset_owners () IS 'Ensures episode_templates preset FKs (both required) reference presets owned by episode_templates.user_id.';

DROP TRIGGER IF EXISTS episode_template_preset_owners ON public.episode_templates;

CREATE TRIGGER episode_template_preset_owners
  BEFORE INSERT OR UPDATE OF symptom_preset_id, health_marker_preset_id, user_id ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_episode_template_preset_owners ();

DROP TRIGGER IF EXISTS set_updated_at ON public.episode_templates;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

ALTER TABLE public.episode_templates
  ENABLE ROW LEVEL SECURITY;

-- Policies align with public.symptom_presets / public.health_marker_presets (20260327130000_rls_policies.sql).
-- SELECT: patient OR caretaker (grant) OR practitioner (grant + MFA path via user_has_practitioner_access).
-- INSERT/UPDATE/DELETE: patient OR caretaker only—practitioners have no write policies on this table (PRD: PHI read-only for practitioners).
DROP POLICY IF EXISTS episode_templates_select ON public.episode_templates;

DROP POLICY IF EXISTS episode_templates_insert ON public.episode_templates;

DROP POLICY IF EXISTS episode_templates_update ON public.episode_templates;

DROP POLICY IF EXISTS episode_templates_delete ON public.episode_templates;

CREATE POLICY episode_templates_select ON public.episode_templates
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY episode_templates_insert ON public.episode_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_templates_update ON public.episode_templates
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_templates_delete ON public.episode_templates
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

DROP TRIGGER IF EXISTS phi_user_id_immutable ON public.episode_templates;

CREATE TRIGGER phi_user_id_immutable
  BEFORE UPDATE ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_phi_row_user_id_immutable ();
