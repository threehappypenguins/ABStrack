-- Patient practitioner Edge (`patient-practitioner-access`): trusted `practitioner_access` writes
-- when the Edge client uses the secret key under RLS (service_role policies below).
--
-- SELECT on practitioner_access already exists (20260416120000_practitioner_mfa_assurance_rls.sql)
-- for MFA audit. Invite email throttling uses `practitioner_invites.last_invite_sent_at` and
-- `practitioner_access.last_invite_email_sent_at` (see later migrations), not a separate table.

CREATE POLICY practitioner_access_service_role_insert ON public.practitioner_access
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY practitioner_access_service_role_update ON public.practitioner_access
  FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON POLICY practitioner_access_service_role_insert ON public.practitioner_access IS 'Trusted INSERT for patient-practitioner-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY practitioner_access_service_role_update ON public.practitioner_access IS 'Trusted UPDATE (revoke via revoked_at, reactivate grant) for patient-practitioner-access when service_role is subject to RLS.';

-- Batch Auth emails for GET grants: one round-trip instead of N `auth.admin.getUserById` calls (rate limits).
CREATE OR REPLACE FUNCTION public.list_practitioner_auth_emails_for_patient_grants(
  p_patient_user_id uuid,
  p_practitioner_user_ids uuid[]
)
RETURNS TABLE (practitioner_user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (u.id)
    u.id AS practitioner_user_id,
    u.email::text AS email
  FROM unnest(p_practitioner_user_ids) AS requested (practitioner_user_id)
  INNER JOIN public.practitioner_access AS pa
    ON pa.practitioner_user_id = requested.practitioner_user_id
   AND pa.patient_user_id = p_patient_user_id
   AND pa.revoked_at IS NULL
  INNER JOIN auth.users AS u
    ON u.id = requested.practitioner_user_id
  ORDER BY u.id;
$$;

COMMENT ON FUNCTION public.list_practitioner_auth_emails_for_patient_grants (uuid, uuid[]) IS 'Returns auth.users.email for practitioner ids that have an active practitioner_access grant to the given patient; patient-practitioner-access GET only. SECURITY DEFINER; service_role EXECUTE only.';

REVOKE ALL ON FUNCTION public.list_practitioner_auth_emails_for_patient_grants (uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_practitioner_auth_emails_for_patient_grants (uuid, uuid[]) TO service_role;
