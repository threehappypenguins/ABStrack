-- Patient-sent practitioner email invites before `practitioner_access` exists (caretaker-style flow).
-- One pending row per patient (partial unique). Consumed when the invitee finalizes via Edge.
-- RLS deny-by-default; explicit service_role policies match `caretaker_invites` / `practitioner_invite_send_throttle`.

CREATE TABLE public.practitioner_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  invitee_email_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_practitioner_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  last_invite_sent_at timestamptz,
  CONSTRAINT practitioner_invites_invitee_email_normalized_check CHECK (
    invitee_email_normalized = lower(trim(invitee_email_normalized))
    AND char_length(invitee_email_normalized) BETWEEN 1 AND 254
  ),
  CONSTRAINT practitioner_invites_expires_at_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX practitioner_invites_one_pending_per_patient_idx ON public.practitioner_invites (patient_user_id)
WHERE
  consumed_at IS NULL;

CREATE INDEX practitioner_invites_pending_by_email_idx ON public.practitioner_invites (invitee_email_normalized)
WHERE
  consumed_at IS NULL;

COMMENT ON TABLE public.practitioner_invites IS 'Patient-sent practitioner invite before `practitioner_access`; one pending row per patient (partial unique).';

ALTER TABLE public.practitioner_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY practitioner_invites_service_role_select ON public.practitioner_invites
  FOR SELECT
  TO service_role
  USING (TRUE);

CREATE POLICY practitioner_invites_service_role_insert ON public.practitioner_invites
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

CREATE POLICY practitioner_invites_service_role_update ON public.practitioner_invites
  FOR UPDATE
  TO service_role
  USING (consumed_at IS NULL)
  WITH CHECK (TRUE);

CREATE POLICY practitioner_invites_service_role_delete ON public.practitioner_invites
  FOR DELETE
  TO service_role
  USING (consumed_at IS NULL);

COMMENT ON POLICY practitioner_invites_service_role_select ON public.practitioner_invites IS 'Trusted SELECT for patient-practitioner-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY practitioner_invites_service_role_insert ON public.practitioner_invites IS 'Trusted INSERT for patient-practitioner-access Edge Function when service_role is subject to RLS.';
COMMENT ON POLICY practitioner_invites_service_role_update ON public.practitioner_invites IS 'Trusted UPDATE for pending rows only (USING consumed_at IS NULL): resend stamp, extend expiry, consume; consumed rows are immutable via UPDATE.';
COMMENT ON POLICY practitioner_invites_service_role_delete ON public.practitioner_invites IS 'Trusted DELETE for pending rows only (USING consumed_at IS NULL): clear pending / rollback; consumed rows are retained.';

CREATE OR REPLACE FUNCTION public.stamp_practitioner_invite_pre_send(
  p_invite_id uuid,
  p_stamp timestamptz,
  p_throttle_cutoff timestamptz
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.practitioner_invites
  SET last_invite_sent_at = p_stamp
  WHERE id = p_invite_id
    AND consumed_at IS NULL
    AND (last_invite_sent_at IS NULL OR last_invite_sent_at < p_throttle_cutoff)
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.stamp_practitioner_invite_pre_send(uuid, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.stamp_practitioner_invite_pre_send(uuid, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.stamp_practitioner_invite_pre_send (uuid, timestamptz, timestamptz) IS 'Atomically stamps practitioner_invites.last_invite_sent_at before inviteUserByEmail; service_role only.';
