-- ABStrack — Row Level Security (issue #8 / Week 2)
--
-- PRD: Authorized access, RLS requirements table, Access logging (append-only).
-- Practitioner MFA (aal2) is centralized in user_has_practitioner_access() for Week 5.
-- Grant tables: triggers enforce profiles.app_role on grant endpoints; helpers require
-- matching app_role for the current user (fail-closed PHI reads/writes).

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER: only own profile + own-visible grant rows; RLS applies.
-- Week 5: add JWT/aal predicate on practitioner path.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_practitioner_access (p_patient_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.practitioner_access pa
          INNER JOIN public.profiles pr ON pr.id = (SELECT auth.uid())
        WHERE
          pa.patient_user_id = p_patient_user_id
          AND pa.practitioner_user_id = (SELECT auth.uid())
          AND pa.revoked_at IS NULL
          AND pr.app_role = 'practitioner');

$$;

COMMENT ON FUNCTION public.user_has_practitioner_access (uuid) IS 'True when the current user has profiles.app_role practitioner and an active practitioner_access grant for this patient. Fail-closed; extend in Week 5 with MFA (e.g. aal2).';

CREATE OR REPLACE FUNCTION public.user_is_caretaker_for_patient (p_patient_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.caretaker_access ca
          INNER JOIN public.profiles pr ON pr.id = (SELECT auth.uid())
        WHERE
          ca.patient_user_id = p_patient_user_id
          AND ca.caretaker_user_id = (SELECT auth.uid())
          AND ca.revoked_at IS NULL
          AND pr.app_role = 'caretaker');

$$;

COMMENT ON FUNCTION public.user_is_caretaker_for_patient (uuid) IS 'True when the current user has profiles.app_role caretaker and an active caretaker_access link to this patient.';

REVOKE ALL ON FUNCTION public.user_has_practitioner_access (uuid)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.user_is_caretaker_for_patient (uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.user_has_practitioner_access (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_is_caretaker_for_patient (uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Grant tables: require profile roles on insert/update (RLS hides other users' profiles)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_practitioner_access_profile_roles ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.patient_user_id
      AND p.app_role = 'patient') THEN
    RAISE EXCEPTION 'practitioner_access.patient_user_id must reference a profile with app_role patient';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.practitioner_user_id
      AND p.app_role = 'practitioner') THEN
    RAISE EXCEPTION 'practitioner_access.practitioner_user_id must reference a profile with app_role practitioner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER practitioner_access_profile_roles
  BEFORE INSERT OR UPDATE ON public.practitioner_access
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_practitioner_access_profile_roles ();

CREATE OR REPLACE FUNCTION public.enforce_caretaker_access_profile_roles ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.patient_user_id
      AND p.app_role = 'patient') THEN
    RAISE EXCEPTION 'caretaker_access.patient_user_id must reference a profile with app_role patient';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.caretaker_user_id
      AND p.app_role = 'caretaker') THEN
    RAISE EXCEPTION 'caretaker_access.caretaker_user_id must reference a profile with app_role caretaker';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER caretaker_access_profile_roles
  BEFORE INSERT OR UPDATE ON public.caretaker_access
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_caretaker_access_profile_roles ();

COMMENT ON FUNCTION public.enforce_practitioner_access_profile_roles () IS 'Ensures practitioner grants only link patient + practitioner profiles per PRD; runs under definer to read profiles despite RLS.';

COMMENT ON FUNCTION public.enforce_caretaker_access_profile_roles () IS 'Ensures caretaker grants only link patient + caretaker profiles per PRD; runs under definer to read profiles despite RLS.';

REVOKE ALL ON FUNCTION public.enforce_practitioner_access_profile_roles ()
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.enforce_caretaker_access_profile_roles ()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enforce_practitioner_access_profile_roles () TO authenticated;

GRANT EXECUTE ON FUNCTION public.enforce_caretaker_access_profile_roles () TO authenticated;

GRANT EXECUTE ON FUNCTION public.enforce_practitioner_access_profile_roles () TO service_role;

GRANT EXECUTE ON FUNCTION public.enforce_caretaker_access_profile_roles () TO service_role;

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
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'access_log is append-only';
  END IF;

  -- UPDATE: allow only auth.users FK ON DELETE SET NULL on actor_user_id / patient_user_id;
  -- all other columns must be unchanged (append-only audit semantics).
  IF TG_OP = 'UPDATE'
    AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.occurred_at IS NOT DISTINCT FROM NEW.occurred_at
    AND OLD.actor_role IS NOT DISTINCT FROM NEW.actor_role
    AND OLD.action IS NOT DISTINCT FROM NEW.action
    AND OLD.resource_type IS NOT DISTINCT FROM NEW.resource_type
    AND OLD.resource_id IS NOT DISTINCT FROM NEW.resource_id
    AND OLD.request_id IS NOT DISTINCT FROM NEW.request_id
    AND OLD.ip_hash IS NOT DISTINCT FROM NEW.ip_hash
    AND (
      OLD.actor_user_id IS NOT DISTINCT FROM NEW.actor_user_id
      OR (OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL)
    )
    AND (
      OLD.patient_user_id IS NOT DISTINCT FROM NEW.patient_user_id
      OR (OLD.patient_user_id IS NOT NULL AND NEW.patient_user_id IS NULL)
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'access_log is append-only';
END;
$$;

COMMENT ON FUNCTION public.access_log_prevent_update_or_delete () IS 'Blocks UPDATE/DELETE except FK cleanup when referenced auth.users rows are deleted (SET NULL on actor_user_id / patient_user_id only).';

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

-- profiles: own row only; app_role is not self-service for practitioner (PRD: invitation path).
-- Authenticated has no DELETE policy (avoids delete + reinsert to swap patient/caretaker).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_trusted_session_for_app_role ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT
      COALESCE((auth.jwt() ->> 'role') = 'service_role', FALSE)
      OR session_user = 'postgres';

$$;

COMMENT ON FUNCTION public.profiles_trusted_session_for_app_role () IS 'True for service_role JWT or direct postgres session (migrations / trusted role assignment).';

REVOKE ALL ON FUNCTION public.profiles_trusted_session_for_app_role ()
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.profiles_enforce_app_role ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.app_role = 'practitioner'
      AND NOT public.profiles_trusted_session_for_app_role () THEN
      RAISE EXCEPTION 'profiles.app_role practitioner requires a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.app_role IS DISTINCT FROM NEW.app_role
      AND NOT public.profiles_trusted_session_for_app_role () THEN
      RAISE EXCEPTION 'profiles.app_role cannot be changed without a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_enforce_app_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_enforce_app_role ();

COMMENT ON FUNCTION public.profiles_enforce_app_role () IS 'Blocks practitioner self-signup and arbitrary app_role changes unless session is trusted (service_role / postgres).';

REVOKE ALL ON FUNCTION public.profiles_enforce_app_role ()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.profiles_enforce_app_role () TO authenticated;

GRANT EXECUTE ON FUNCTION public.profiles_enforce_app_role () TO service_role;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid())
    AND app_role IN ('patient', 'caretaker'));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_service_role_all ON public.profiles
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

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

-- access_log: read rules from PRD; authenticated has no INSERT (trusted path uses service_role).
-- Explicit service_role policies so INSERT/SELECT succeed even if BYPASSRLS is not set (local/self-hosted).
CREATE POLICY access_log_select ON public.access_log
  FOR SELECT
  TO authenticated
  USING (patient_user_id = (SELECT auth.uid())
  OR actor_user_id = (SELECT auth.uid()));

CREATE POLICY access_log_service_role_select ON public.access_log
  FOR SELECT
  TO service_role
  USING (TRUE);

CREATE POLICY access_log_service_role_insert ON public.access_log
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY access_log_deny_update ON public.access_log
  FOR UPDATE
  TO authenticated
  USING (FALSE);

CREATE POLICY access_log_deny_delete ON public.access_log
  FOR DELETE
  TO authenticated
  USING (FALSE);
