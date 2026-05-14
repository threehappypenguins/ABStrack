-- Patient practitioner Edge (`patient-practitioner-access`): trusted `practitioner_access` writes,
-- invite-email throttle table + stamp RPC. Matches caretaker_access service_role patterns in
-- 20260510120000_caretaker_invites.sql when service_role is subject to RLS.
--
-- SELECT on practitioner_access already exists (20260416120000_practitioner_mfa_assurance_rls.sql)
-- for MFA audit.

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

-- ---------------------------------------------------------------------------
-- Invite / resend email throttle (mirrors caretaker_invites.last_invite_sent_at + Edge interval)
-- ---------------------------------------------------------------------------

CREATE TABLE public.practitioner_invite_send_throttle (
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  invitee_email_normalized text NOT NULL,
  last_invite_sent_at timestamptz NOT NULL,
  PRIMARY KEY (patient_user_id, invitee_email_normalized),
  CONSTRAINT practitioner_invite_send_throttle_email_check CHECK (
    invitee_email_normalized = lower(trim(invitee_email_normalized))
    AND char_length(invitee_email_normalized) BETWEEN 1 AND 254
  )
);

COMMENT ON TABLE public.practitioner_invite_send_throttle IS 'Per-patient+email throttle for practitioner inviteUserByEmail; Edge stamps before send (atomic upsert).';

ALTER TABLE public.practitioner_invite_send_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY practitioner_invite_send_throttle_service_role_select ON public.practitioner_invite_send_throttle
  FOR SELECT
  TO service_role
  USING (TRUE);

CREATE POLICY practitioner_invite_send_throttle_service_role_insert ON public.practitioner_invite_send_throttle
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY practitioner_invite_send_throttle_service_role_update ON public.practitioner_invite_send_throttle
  FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON POLICY practitioner_invite_send_throttle_service_role_select ON public.practitioner_invite_send_throttle IS 'patient-practitioner-access reads throttle for Retry-After when stamp returns no row.';
COMMENT ON POLICY practitioner_invite_send_throttle_service_role_insert ON public.practitioner_invite_send_throttle IS 'patient-practitioner-access upsert via stamp RPC.';
COMMENT ON POLICY practitioner_invite_send_throttle_service_role_update ON public.practitioner_invite_send_throttle IS 'patient-practitioner-access stamp RPC updates existing row when outside resend window.';

CREATE OR REPLACE FUNCTION public.stamp_practitioner_invite_send_throttle(
  p_patient_user_id uuid,
  p_invitee_email_normalized text,
  p_stamp timestamptz,
  p_throttle_cutoff timestamptz
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.practitioner_invite_send_throttle AS t (
    patient_user_id,
    invitee_email_normalized,
    last_invite_sent_at
  )
  VALUES (p_patient_user_id, p_invitee_email_normalized, p_stamp)
  ON CONFLICT (patient_user_id, invitee_email_normalized)
  DO UPDATE SET
    last_invite_sent_at = EXCLUDED.last_invite_sent_at
  WHERE
    t.last_invite_sent_at < p_throttle_cutoff
  RETURNING patient_user_id;
$$;

REVOKE ALL ON FUNCTION public.stamp_practitioner_invite_send_throttle(uuid, text, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.stamp_practitioner_invite_send_throttle(uuid, text, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.stamp_practitioner_invite_send_throttle (uuid, text, timestamptz, timestamptz) IS 'Atomically records practitioner invite email send when outside resend window; service_role only.';

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
