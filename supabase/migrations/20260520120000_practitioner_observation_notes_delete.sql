-- PRD §8: practitioners may delete their own observation notes (same grant path as update).

CREATE POLICY practitioner_observation_notes_delete ON public.practitioner_observation_notes
  FOR DELETE
  TO authenticated
  USING (practitioner_user_id = (SELECT auth.uid())
    AND public.user_has_practitioner_access (patient_user_id));

COMMENT ON POLICY practitioner_observation_notes_delete ON public.practitioner_observation_notes IS 'Practitioner may DELETE own notes when grant + MFA rules pass via user_has_practitioner_access (password-gated AAL2).';
