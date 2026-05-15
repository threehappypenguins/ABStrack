-- Practitioner PHI reads: require JWT `aal2` only when the account uses password sign-in
-- (`user_metadata.abstrack_practitioner_password_set`). Magic-link–only practitioners may read
-- with AAL1; password sign-in remains protected against credential stuffing via TOTP + AAL2.

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
  v_requires_mfa boolean;
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

  v_requires_mfa := COALESCE(
    (auth.jwt() -> 'user_metadata' ->> 'abstrack_practitioner_password_set') = 'true',
    FALSE
  );

  IF v_requires_mfa AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Practitioner MFA assurance (AAL2) is required to access patient data'
      USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.user_has_practitioner_access (uuid) IS 'True when the current user has profiles.app_role practitioner and an active practitioner_access grant. Raises 42501 when abstrack_practitioner_password_set is true in JWT user_metadata but aal is not aal2; magic-link–only accounts (flag false/absent) may read with AAL1.';
