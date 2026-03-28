-- ABStrack — Row Level Security (issue #8 / Week 2)
--
-- PRD: Authorized access, RLS requirements table, Access logging (append-only).
-- Practitioner MFA (aal2) is centralized in user_has_practitioner_access() for Week 5.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: stable join to grant tables; Week 5: add JWT/aal predicate here)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_practitioner_access (p_patient_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.practitioner_access pa
        WHERE
          pa.patient_user_id = p_patient_user_id
          AND pa.practitioner_user_id = (SELECT auth.uid())
          AND pa.revoked_at IS NULL);

$$;

COMMENT ON FUNCTION public.user_has_practitioner_access (uuid) IS 'True when the current user is the granted practitioner for this patient (active grant). Extend in Week 5 with fail-closed MFA (e.g. aal2) in one place.';

CREATE OR REPLACE FUNCTION public.user_is_caretaker_for_patient (p_patient_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.caretaker_access ca
        WHERE
          ca.patient_user_id = p_patient_user_id
          AND ca.caretaker_user_id = (SELECT auth.uid())
          AND ca.revoked_at IS NULL);

$$;

COMMENT ON FUNCTION public.user_is_caretaker_for_patient (uuid) IS 'True when the current user is the active caretaker linked to this patient.';

GRANT EXECUTE ON FUNCTION public.user_has_practitioner_access (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_is_caretaker_for_patient (uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Append-only access_log: privileges + trigger (RLS policies below)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.access_log
  FROM PUBLIC;

REVOKE ALL ON public.access_log
  FROM anon;

REVOKE ALL ON public.access_log
  FROM authenticated;

GRANT
  SELECT ON public.access_log TO authenticated;

-- Trusted path (Edge Function / automation) uses service_role; clients use authenticated only.
GRANT
  INSERT,
  SELECT ON public.access_log TO service_role;

CREATE OR REPLACE FUNCTION public.access_log_prevent_update_or_delete ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'access_log is append-only';
END;
$$;

CREATE TRIGGER access_log_append_only
  BEFORE UPDATE OR DELETE ON public.access_log
  FOR EACH ROW
  EXECUTE FUNCTION public.access_log_prevent_update_or_delete ();

-- ---------------------------------------------------------------------------
-- RLS: patient-owned PHI rows (same pattern on all)
-- ---------------------------------------------------------------------------
-- Expression: owner OR caretaker (read/write) OR practitioner (read only via helper).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.symptom_presets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.preset_symptoms
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.health_marker_presets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.preset_health_markers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.episodes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.episode_symptoms
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.health_markers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.food_diary_entries
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.episode_media
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.practitioner_access
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.caretaker_access
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.access_log
  ENABLE ROW LEVEL SECURITY;

-- profiles: own row only (routing metadata; not caretaker-as-patient proxy)
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_delete_own ON public.profiles
  FOR DELETE
  TO authenticated
  USING (id = (SELECT auth.uid()));

-- symptom_presets
CREATE POLICY symptom_presets_select ON public.symptom_presets
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY symptom_presets_insert ON public.symptom_presets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY symptom_presets_update ON public.symptom_presets
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY symptom_presets_delete ON public.symptom_presets
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- preset_symptoms (ownership via parent preset)
CREATE POLICY preset_symptoms_select ON public.preset_symptoms
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets sp
    WHERE
      sp.id = preset_symptoms.preset_id
      AND (sp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (sp.user_id)
        OR public.user_has_practitioner_access (sp.user_id))));

CREATE POLICY preset_symptoms_insert ON public.preset_symptoms
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets sp
    WHERE
      sp.id = preset_symptoms.preset_id
      AND (sp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (sp.user_id))));

CREATE POLICY preset_symptoms_update ON public.preset_symptoms
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets sp
    WHERE
      sp.id = preset_symptoms.preset_id
      AND (sp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (sp.user_id))))
  WITH CHECK (EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets sp
    WHERE
      sp.id = preset_symptoms.preset_id
      AND (sp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (sp.user_id))));

CREATE POLICY preset_symptoms_delete ON public.preset_symptoms
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets sp
    WHERE
      sp.id = preset_symptoms.preset_id
      AND (sp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (sp.user_id))));

-- health_marker_presets
CREATE POLICY health_marker_presets_select ON public.health_marker_presets
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY health_marker_presets_insert ON public.health_marker_presets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY health_marker_presets_update ON public.health_marker_presets
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY health_marker_presets_delete ON public.health_marker_presets
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- preset_health_markers
CREATE POLICY preset_health_markers_select ON public.preset_health_markers
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets hp
    WHERE
      hp.id = preset_health_markers.preset_id
      AND (hp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (hp.user_id)
        OR public.user_has_practitioner_access (hp.user_id))));

CREATE POLICY preset_health_markers_insert ON public.preset_health_markers
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets hp
    WHERE
      hp.id = preset_health_markers.preset_id
      AND (hp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (hp.user_id))));

CREATE POLICY preset_health_markers_update ON public.preset_health_markers
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets hp
    WHERE
      hp.id = preset_health_markers.preset_id
      AND (hp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (hp.user_id))))
  WITH CHECK (EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets hp
    WHERE
      hp.id = preset_health_markers.preset_id
      AND (hp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (hp.user_id))));

CREATE POLICY preset_health_markers_delete ON public.preset_health_markers
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets hp
    WHERE
      hp.id = preset_health_markers.preset_id
      AND (hp.user_id = (SELECT auth.uid())
        OR public.user_is_caretaker_for_patient (hp.user_id))));

-- episodes
CREATE POLICY episodes_select ON public.episodes
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY episodes_insert ON public.episodes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episodes_update ON public.episodes
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episodes_delete ON public.episodes
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- episode_symptoms
CREATE POLICY episode_symptoms_select ON public.episode_symptoms
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY episode_symptoms_insert ON public.episode_symptoms
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_symptoms_update ON public.episode_symptoms
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_symptoms_delete ON public.episode_symptoms
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- health_markers
CREATE POLICY health_markers_select ON public.health_markers
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY health_markers_insert ON public.health_markers
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY health_markers_update ON public.health_markers
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY health_markers_delete ON public.health_markers
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- food_diary_entries
CREATE POLICY food_diary_entries_select ON public.food_diary_entries
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY food_diary_entries_insert ON public.food_diary_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY food_diary_entries_update ON public.food_diary_entries
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY food_diary_entries_delete ON public.food_diary_entries
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- episode_media
CREATE POLICY episode_media_select ON public.episode_media
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id)
    OR public.user_has_practitioner_access (user_id));

CREATE POLICY episode_media_insert ON public.episode_media
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_media_update ON public.episode_media
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id))
  WITH CHECK (user_id = (SELECT auth.uid())
  OR public.user_is_caretaker_for_patient (user_id));

CREATE POLICY episode_media_delete ON public.episode_media
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid())
    OR public.user_is_caretaker_for_patient (user_id));

-- practitioner_access (PRD grant table)
CREATE POLICY practitioner_access_patient_all ON public.practitioner_access
  FOR ALL
  TO authenticated
  USING (patient_user_id = (SELECT auth.uid()))
  WITH CHECK (patient_user_id = (SELECT auth.uid()));

CREATE POLICY practitioner_access_practitioner_select ON public.practitioner_access
  FOR SELECT
  TO authenticated
  USING (practitioner_user_id = (SELECT auth.uid()));

-- caretaker_access (PRD grant table)
CREATE POLICY caretaker_access_patient_all ON public.caretaker_access
  FOR ALL
  TO authenticated
  USING (patient_user_id = (SELECT auth.uid()))
  WITH CHECK (patient_user_id = (SELECT auth.uid()));

CREATE POLICY caretaker_access_caretaker_select ON public.caretaker_access
  FOR SELECT
  TO authenticated
  USING (caretaker_user_id = (SELECT auth.uid()));

-- access_log: read rules from PRD; no INSERT/UPDATE/DELETE for authenticated (service_role bypasses RLS)
CREATE POLICY access_log_select ON public.access_log
  FOR SELECT
  TO authenticated
  USING (patient_user_id = (SELECT auth.uid())
  OR actor_user_id = (SELECT auth.uid()));

CREATE POLICY access_log_deny_update ON public.access_log
  FOR UPDATE
  TO authenticated
  USING (FALSE);

CREATE POLICY access_log_deny_delete ON public.access_log
  FOR DELETE
  TO authenticated
  USING (FALSE);
