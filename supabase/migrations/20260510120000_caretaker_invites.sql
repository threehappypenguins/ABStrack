-- Caretaker email invites (PRD §7): patient sends invite before `caretaker_access` row exists.
-- Consumed when the invitee completes join (Edge finalization). RLS deny-by-default; Edge uses
-- service-role client (secret API key) only.

CREATE TABLE public.caretaker_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  invitee_email_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_caretaker_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  last_invite_sent_at timestamptz
);

CREATE UNIQUE INDEX caretaker_invites_one_pending_per_patient_idx ON public.caretaker_invites (patient_user_id)
WHERE
  consumed_at IS NULL;

CREATE INDEX caretaker_invites_pending_by_email_idx ON public.caretaker_invites (invitee_email_normalized)
WHERE
  consumed_at IS NULL;

COMMENT ON TABLE public.caretaker_invites IS 'Patient-sent caretaker invite before `caretaker_access`; one pending row per patient (partial unique).';

ALTER TABLE public.caretaker_invites ENABLE ROW LEVEL SECURITY;
