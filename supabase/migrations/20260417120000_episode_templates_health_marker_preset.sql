-- Episode rows: optional health-marker preset (same-owner pattern as symptom_preset_id).
-- episode_templates: named pairing of symptom + health-marker presets for template-first episode starts.

-- ---------------------------------------------------------------------------
-- episodes.health_marker_preset_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.episodes
  ADD COLUMN health_marker_preset_id uuid;

ALTER TABLE public.episodes
  ADD CONSTRAINT episodes_health_marker_preset_id_fk FOREIGN KEY (health_marker_preset_id)
    REFERENCES public.health_marker_presets (id)
    ON DELETE SET NULL;

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

DROP TRIGGER episode_symptom_preset_owner ON public.episodes;

DROP FUNCTION public.enforce_episode_symptom_preset_owner ();

CREATE TRIGGER episode_preset_owners
  BEFORE INSERT OR UPDATE OF symptom_preset_id, health_marker_preset_id, user_id ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_episode_preset_owners ();

-- ---------------------------------------------------------------------------
-- episode_templates — always a usable pair (NOT NULL); CASCADE removes row if either preset is deleted
-- ---------------------------------------------------------------------------
CREATE TABLE public.episode_templates (
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

CREATE INDEX episode_templates_user_idx ON public.episode_templates (user_id);

COMMENT ON TABLE public.episode_templates IS 'Named template: required symptom + health-marker preset pair for episode starts (both FKs NOT NULL). Deleting either preset CASCADE-deletes the template. RLS matches symptom_presets / health_marker_presets: patient owner and caretaker may read/write; practitioner may read when granted (user_has_practitioner_access); user_id immutability via phi_user_id_immutable.';
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

CREATE TRIGGER episode_template_preset_owners
  BEFORE INSERT OR UPDATE OF symptom_preset_id, health_marker_preset_id, user_id ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_episode_template_preset_owners ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

ALTER TABLE public.episode_templates
  ENABLE ROW LEVEL SECURITY;

-- Same pattern as symptom_presets / health_marker_presets (caretaker read/write, practitioner read).
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

CREATE TRIGGER phi_user_id_immutable
  BEFORE UPDATE ON public.episode_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_phi_row_user_id_immutable ();
