CREATE OR REPLACE FUNCTION public.stamp_caretaker_invite_pre_send(
  p_invite_id uuid,
  p_stamp timestamptz,
  p_throttle_cutoff timestamptz
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.caretaker_invites
  SET last_invite_sent_at = p_stamp
  WHERE id = p_invite_id
    AND consumed_at IS NULL
    AND (last_invite_sent_at IS NULL OR last_invite_sent_at < p_throttle_cutoff)
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.stamp_caretaker_invite_pre_send(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_caretaker_invite_pre_send(uuid, timestamptz, timestamptz) TO service_role;