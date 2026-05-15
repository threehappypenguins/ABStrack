-- Practitioner patient directory: read patient profile display names only for active grants,
-- using the same MFA + grant checks as PHI via user_has_practitioner_access(patient_user_id).

CREATE POLICY profiles_practitioner_granted_patient_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    app_role = 'patient'
    AND public.user_has_practitioner_access (id));

COMMENT ON POLICY profiles_practitioner_granted_patient_select ON public.profiles IS 'Practitioner may SELECT patient profiles for active practitioner_access grants; MFA rules match user_has_practitioner_access (password-gated AAL2).';
