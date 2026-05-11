-- Caretaker email invites (PRD §7): patient sends invite before `caretaker_access` row exists.
-- Consumed when the invitee completes join (Edge finalization). RLS deny-by-default for
-- PostgREST roles; explicit per-operation service_role policies match the narrow style used for
-- access_log (20260327130000_rls_policies.sql) and practitioner_access SELECT-only automation
-- (20260416120000_practitioner_mfa_assurance_rls.sql) when service_role is subject to RLS.
--
-- Also adds service_role policies on public.caretaker_access: patient-caretaker-access uses the
-- elevated client for grant rows; base migration only defines TO authenticated policies.
-- Edge uses SELECT/INSERT/UPDATE on grants (revocation sets revoked_at); no service_role DELETE.
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

CREATE POLICY caretaker_invites_service_role_select ON public.caretaker_invites
  FOR SELECT
  TO service_role
  USING (TRUE);

CREATE POLICY caretaker_invites_service_role_insert ON public.caretaker_invites
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY caretaker_invites_service_role_update ON public.caretaker_invites
  FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY caretaker_invites_service_role_delete ON public.caretaker_invites
  FOR DELETE
  TO service_role
  USING (TRUE);

COMMENT ON POLICY caretaker_invites_service_role_select ON public.caretaker_invites IS 'Trusted SELECT for patient-caretaker-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY caretaker_invites_service_role_insert ON public.caretaker_invites IS 'Trusted INSERT for patient-caretaker-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY caretaker_invites_service_role_update ON public.caretaker_invites IS 'Trusted UPDATE (consume invite, stamp resend) for patient-caretaker-access when service_role is subject to RLS.';
COMMENT ON POLICY caretaker_invites_service_role_delete ON public.caretaker_invites IS 'Trusted DELETE (clear pending / rollback) for patient-caretaker-access when service_role is subject to RLS.';

-- caretaker_access: Edge uses SELECT/INSERT/UPDATE only (revoke = UPDATE revoked_at; no row DELETE).
CREATE POLICY caretaker_access_service_role_select ON public.caretaker_access
  FOR SELECT
  TO service_role
  USING (TRUE);

CREATE POLICY caretaker_access_service_role_insert ON public.caretaker_access
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY caretaker_access_service_role_update ON public.caretaker_access
  FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON POLICY caretaker_access_service_role_select ON public.caretaker_access IS 'Trusted SELECT for patient-caretaker-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY caretaker_access_service_role_insert ON public.caretaker_access IS 'Trusted INSERT for patient-caretaker-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY caretaker_access_service_role_update ON public.caretaker_access IS 'Trusted UPDATE (revoke, reactivate, finalize rollback) for patient-caretaker-access when service_role is subject to RLS.';

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
