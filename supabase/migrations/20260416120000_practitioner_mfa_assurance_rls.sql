-- Practitioner patient-data reads: fail closed on MFA assurance (AAL2).
--
-- PRD: RLS must not rely on a custom access token hook that can omit claims; require
-- auth.jwt()->>'aal' = 'aal2' on the practitioner grant path. If an active practitioner_access
-- grant exists but assurance is missing or not aal2, deny with SQLSTATE 42501 so PostgREST
-- returns a permission error (not an empty 200).
--
-- Note: Raising aborts the transaction, so no access_log row is written in the same request;
-- use the Edge Function practitioner-mfa-auth-audit for append-only auth_failure rows in a
-- separate transaction when explicit server-side audit is required.
--
-- STABLE: no writes; reads grants/profile and auth.jwt() only. RAISE does not persist data.
-- VOLATILE is unnecessary and can pessimise planner behaviour for repeated same-arg calls.

CREATE OR REPLACE FUNCTION public.user_has_practitioner_access (p_patient_user_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_grant boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.practitioner_access pa
        INNER JOIN public.profiles pr ON pr.id = v_uid
      WHERE
        pa.patient_user_id = p_patient_user_id
        AND pa.practitioner_user_id = v_uid
        AND pa.revoked_at IS NULL
        AND pr.app_role = 'practitioner') INTO v_has_grant;

  IF NOT v_has_grant THEN
    RETURN FALSE;
  END IF;

  -- Active practitioner grant: require AAL2 (TOTP-verified session). Missing or non-aal2 claim
  -- fails closed (PRD: no hook-only reliance).
  IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Practitioner MFA assurance (AAL2) is required to access patient data'
      USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.user_has_practitioner_access (uuid) IS 'True when the current user has profiles.app_role practitioner, an active practitioner_access grant for this patient, and JWT aal claim is aal2 (MFA assurance). If a grant exists but aal is missing or not aal2, raises insufficient_privilege (42501), fail-closed.';
