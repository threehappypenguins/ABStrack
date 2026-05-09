-- PRD §8: practitioner observation notes (episode-scoped and/or patient-level).
--
-- Notes are stored in this dedicated table—not as writes to patient-owned PHI rows (`episodes`,
-- `episode_symptoms`, etc.). Practitioners receive INSERT/UPDATE only here, gated by
-- public.user_has_practitioner_access(patient_user_id) (active grant + profiles.app_role
-- practitioner + JWT AAL2 per 20260416120000_practitioner_mfa_assurance_rls.sql).
--
-- Read access (SELECT): patient (owner), caretaker with active caretaker_access for that patient,
-- and practitioners with grant + MFA on the same helper. Product intent (PRD §8): the patient
-- (and a caretaker acting for the patient, same as other PHI read paths) can read practitioner
-- notes on their record; practitioners read via the practitioner grant path. No DELETE policy:
-- practitioners may insert/update own rows only; retention is a future product concern.
--
-- PowerSync: PHI-like free text replicates to mobile for offline read paths mirroring other
-- patient-scoped tables (sync-rules.yaml + publication below).

CREATE TABLE public.practitioner_observation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  episode_id uuid,
  practitioner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body text NOT NULL
    CHECK (char_length(body) <= 16000),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT practitioner_observation_notes_episode_owner_fk FOREIGN KEY (patient_user_id, episode_id)
    REFERENCES public.episodes (user_id, id)
    ON DELETE CASCADE
);

CREATE INDEX practitioner_observation_notes_patient_created_idx ON public.practitioner_observation_notes (patient_user_id, created_at DESC);

CREATE INDEX practitioner_observation_notes_patient_episode_idx ON public.practitioner_observation_notes (patient_user_id, episode_id);

CREATE INDEX practitioner_observation_notes_practitioner_idx ON public.practitioner_observation_notes (practitioner_user_id, patient_user_id);

COMMENT ON TABLE public.practitioner_observation_notes IS 'PRD §8 practitioner-authored observation notes. Scoped by patient_user_id; optional episode_id (NULL = patient-level note). Writes only for practitioners with grant + MFA; patients/caretakers SELECT only.';

COMMENT ON COLUMN public.practitioner_observation_notes.episode_id IS 'When set, note is tied to a specific episode of patient_user_id; NULL means a patient-record-level note (PRD §8).';

COMMENT ON COLUMN public.practitioner_observation_notes.body IS 'Plaintext clinical free text; RLS + TLS + platform encryption at rest (same PHI posture as other note fields).';

CREATE OR REPLACE FUNCTION public.practitioner_observation_notes_immutable_scope ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.patient_user_id IS DISTINCT FROM OLD.patient_user_id
      OR NEW.practitioner_user_id IS DISTINCT FROM OLD.practitioner_user_id
      OR NEW.episode_id IS DISTINCT FROM OLD.episode_id THEN
      RAISE EXCEPTION 'practitioner_observation_notes: patient_user_id, practitioner_user_id, and episode_id cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.practitioner_observation_notes_immutable_scope () IS 'Prevents reassigning a note to another patient, episode, or author after insert.';

REVOKE ALL ON FUNCTION public.practitioner_observation_notes_immutable_scope ()
  FROM PUBLIC;

CREATE TRIGGER practitioner_observation_notes_immutable_scope
  BEFORE UPDATE ON public.practitioner_observation_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.practitioner_observation_notes_immutable_scope ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.practitioner_observation_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

ALTER TABLE public.practitioner_observation_notes
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY practitioner_observation_notes_select ON public.practitioner_observation_notes
  FOR SELECT
  TO authenticated
  USING (patient_user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (patient_user_id)
    OR public.user_has_practitioner_access (patient_user_id));

CREATE POLICY practitioner_observation_notes_insert ON public.practitioner_observation_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (practitioner_user_id = (SELECT auth.uid())
  AND public.user_has_practitioner_access (patient_user_id));

CREATE POLICY practitioner_observation_notes_update ON public.practitioner_observation_notes
  FOR UPDATE
  TO authenticated
  USING (practitioner_user_id = (SELECT auth.uid())
    AND public.user_has_practitioner_access (patient_user_id))
  WITH CHECK (practitioner_user_id = (SELECT auth.uid())
    AND public.user_has_practitioner_access (patient_user_id));

-- ---------------------------------------------------------------------------
-- PowerSync replication (publication + role grant; BYPASSRLS download scope in sync-rules.yaml)
-- Idempotent: skip when powersync_role is absent (environments without 20260430120000) so GRANT
-- does not error; ADD TABLE only when publication exists and the table is not already a member.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT
      1
    FROM
      pg_roles
    WHERE
      rolname = 'powersync_role') THEN
    GRANT SELECT ON TABLE public.practitioner_observation_notes TO powersync_role;
    IF EXISTS (
      SELECT
        1
      FROM
        pg_publication p
      WHERE
        p.pubname = 'powersync') THEN
      IF NOT EXISTS (
        SELECT
          1
        FROM
          pg_publication_tables pt
        WHERE
          pt.pubname = 'powersync'
          AND pt.schemaname = 'public'
          AND pt.tablename::text = 'practitioner_observation_notes') THEN
        ALTER PUBLICATION powersync ADD TABLE public.practitioner_observation_notes;
      END IF;
    END IF;
  END IF;
END
$$;
