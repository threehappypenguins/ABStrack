-- Caretaker email invites (PRD §7): patient sends invite before `caretaker_access` row exists.
-- Consumed when the invitee completes join (Edge finalization). RLS deny-by-default for
-- PostgREST roles; explicit service_role policies mirror access_log (20260327130000_rls_policies.sql)
-- for trusted Edge path when service_role is subject to RLS.
--
-- Also adds service_role policies on public.caretaker_access: patient-caretaker-access uses the
-- elevated client for grant rows; base migration only defines TO authenticated policies.
--
-- resolve_auth_user_id_by_normalized_email: single-query auth.users email lookup for the Edge
-- Function (replaces paginated auth.admin.listUsers scans as user count grows).

CREATE TABLE public.caretaker_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  invitee_email_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_caretaker_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  last_invite_sent_at timestamptz,
  CONSTRAINT caretaker_invites_invitee_email_normalized_check CHECK (
    invitee_email_normalized = lower(trim(invitee_email_normalized))
  ),
  CONSTRAINT caretaker_invites_expires_at_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX caretaker_invites_one_pending_per_patient_idx ON public.caretaker_invites (patient_user_id)
WHERE
  consumed_at IS NULL;

CREATE INDEX caretaker_invites_pending_by_email_idx ON public.caretaker_invites (invitee_email_normalized)
WHERE
  consumed_at IS NULL;

COMMENT ON TABLE public.caretaker_invites IS 'Patient-sent caretaker invite before `caretaker_access`; one pending row per patient (partial unique).';

ALTER TABLE public.caretaker_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY caretaker_invites_service_role_all ON public.caretaker_invites
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON POLICY caretaker_invites_service_role_all ON public.caretaker_invites IS 'Trusted path for patient-caretaker-access Edge Function; mirrors access_log service_role pattern.';

-- caretaker_access: Edge Function reads/writes grants with service_role (same rationale as above).
CREATE POLICY caretaker_access_service_role_all ON public.caretaker_access
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON POLICY caretaker_access_service_role_all ON public.caretaker_access IS 'Trusted path for patient-caretaker-access Edge Function; mirrors access_log service_role pattern.';

CREATE OR REPLACE FUNCTION public.resolve_auth_user_id_by_normalized_email(p_normalized text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IS NOT NULL
    AND lower(trim(u.email::text)) = p_normalized
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_auth_user_id_by_normalized_email (text) IS 'Maps normalized email to auth.users.id for patient-caretaker-access; SECURITY DEFINER; service_role EXECUTE only.';

REVOKE ALL ON FUNCTION public.resolve_auth_user_id_by_normalized_email (text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_auth_user_id_by_normalized_email (text) TO service_role;
