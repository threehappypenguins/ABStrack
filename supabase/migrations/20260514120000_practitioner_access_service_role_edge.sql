-- Trusted INSERT/UPDATE on practitioner_access for the patient-practitioner-access Edge Function
-- (patient-initiated grants + revoke). Matches caretaker_access service_role policies in
-- 20260510120000_caretaker_invites.sql when service_role is subject to RLS.
--
-- SELECT already exists (20260416120000_practitioner_mfa_assurance_rls.sql) for MFA audit.

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
