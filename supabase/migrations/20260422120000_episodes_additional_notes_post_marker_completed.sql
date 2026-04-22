-- Episodes: distinguish "additional" free text (post-preset symptoms/markers) from the general
-- episode note (PRD §4), and record completion of the post–health-marker step for resume UX.

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS additional_notes text,
  ADD COLUMN IF NOT EXISTS post_marker_step_completed_at timestamptz;

COMMENT ON COLUMN public.episodes.additional_notes IS 'Optional free text for symptoms or health markers not in the user''s presets, after preset prompts (PRD §4 step 4).';

COMMENT ON COLUMN public.episodes.note IS 'Optional general note on the episode (PRD §4 step 6). Distinct from additional_notes.';

COMMENT ON COLUMN public.episodes.post_marker_step_completed_at IS 'Set when the user completes the post–health-marker episode details step; used to resume after preset markers without repeating that step.';
