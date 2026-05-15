-- Active-grant inviteUserByEmail resend throttling on practitioner_access (pending practitioner
-- emails use practitioner_invites.last_invite_sent_at + stamp_practitioner_invite_pre_send only).

ALTER TABLE public.practitioner_access
  ADD COLUMN IF NOT EXISTS last_invite_email_sent_at timestamptz;

COMMENT ON COLUMN public.practitioner_access.last_invite_email_sent_at IS 'Last auth.admin.inviteUserByEmail for active-grant resend reminders; throttled via stamp_practitioner_access_last_invite_email_sent_at (patient-practitioner-access Edge).';

CREATE OR REPLACE FUNCTION public.stamp_practitioner_access_last_invite_email_sent_at(
  p_patient_user_id uuid,
  p_practitioner_user_id uuid,
  p_stamp timestamptz,
  p_throttle_cutoff timestamptz
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.practitioner_access
  SET last_invite_email_sent_at = p_stamp
  WHERE patient_user_id = p_patient_user_id
    AND practitioner_user_id = p_practitioner_user_id
    AND revoked_at IS NULL
    AND (last_invite_email_sent_at IS NULL OR last_invite_email_sent_at <= p_throttle_cutoff)
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.stamp_practitioner_access_last_invite_email_sent_at(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.stamp_practitioner_access_last_invite_email_sent_at(uuid, uuid, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.stamp_practitioner_access_last_invite_email_sent_at (uuid, uuid, timestamptz, timestamptz) IS 'Atomically stamps practitioner_access.last_invite_email_sent_at when outside resend window (active-grant invite email); service_role only.';
