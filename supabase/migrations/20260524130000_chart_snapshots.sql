-- Chart snapshots: practitioner shares a chart configuration + note with the patient (PRD §9).
-- Append-only; patient marks snapshots seen via mark_chart_snapshot_seen.

CREATE TABLE public.chart_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  practitioner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  series_definition jsonb NOT NULL,
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  bucket text NOT NULL,
  practitioner_note text,
  created_at timestamptz NOT NULL DEFAULT now (),
  seen_by_patient_at timestamptz,
  CONSTRAINT chart_snapshots_bucket_check CHECK (bucket IN ('day', 'week', 'month')),
  CONSTRAINT chart_snapshots_practitioner_note_len CHECK (
    practitioner_note IS NULL
    OR char_length(practitioner_note) <= 16000
  )
);

CREATE INDEX chart_snapshots_patient_unseen_idx ON public.chart_snapshots (patient_user_id, created_at DESC)
WHERE
  seen_by_patient_at IS NULL;

CREATE INDEX chart_snapshots_practitioner_idx ON public.chart_snapshots (practitioner_user_id, patient_user_id, created_at DESC);

COMMENT ON TABLE public.chart_snapshots IS 'Practitioner-shared chart filter snapshot for patient Insights (PRD §9). Append-only; series_definition stores SelectedSeries[] JSON from the chart builder.';

COMMENT ON COLUMN public.chart_snapshots.series_definition IS 'SelectedSeries[] from @abstrack/ui chart builder (camelCase fields).';

ALTER TABLE public.chart_snapshots
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY chart_snapshots_select ON public.chart_snapshots
  FOR SELECT
  TO authenticated
  USING (
    patient_user_id = (SELECT auth.uid ())
    OR (
      practitioner_user_id = (SELECT auth.uid ())
      AND public.user_has_practitioner_access (patient_user_id)
    )
  );

CREATE POLICY chart_snapshots_insert ON public.chart_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    practitioner_user_id = (SELECT auth.uid ())
    AND public.user_has_practitioner_access (patient_user_id)
  );

-- ---------------------------------------------------------------------------
-- RPC: share_chart_snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.share_chart_snapshot (
  p_patient_user_id uuid,
  p_series_definition jsonb,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_bucket text,
  p_practitioner_note text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.user_has_practitioner_access (p_patient_user_id) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_bucket NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'p_bucket must be day, week, or month';
  END IF;

  IF p_series_definition IS NULL
    OR jsonb_typeof (p_series_definition) <> 'array'
    OR jsonb_array_length (p_series_definition) < 1 THEN
    RAISE EXCEPTION 'p_series_definition must be a non-empty JSON array';
  END IF;

  IF p_date_from IS NULL
    OR p_date_to IS NULL
    OR p_date_from >= p_date_to THEN
    RAISE EXCEPTION 'p_date_from must be before p_date_to';
  END IF;

  INSERT INTO public.chart_snapshots (
    patient_user_id,
    practitioner_user_id,
    series_definition,
    date_from,
    date_to,
    bucket,
    practitioner_note
  )
  VALUES (
    p_patient_user_id,
    (SELECT auth.uid ()),
    p_series_definition,
    p_date_from,
    p_date_to,
    p_bucket,
    NULLIF (trim(p_practitioner_note), '')
  )
  RETURNING
    id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text) IS 'Practitioner shares a chart snapshot with a linked patient. SECURITY INVOKER; requires active practitioner_access + MFA via user_has_practitioner_access.';

REVOKE ALL ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: mark_chart_snapshot_seen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_chart_snapshot_seen (p_snapshot_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE
    public.chart_snapshots
  SET
    seen_by_patient_at = now ()
  WHERE
    id = p_snapshot_id
    AND patient_user_id = (SELECT auth.uid ())
    AND seen_by_patient_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.mark_chart_snapshot_seen (uuid) IS 'Patient marks a shared chart snapshot as seen. SECURITY INVOKER; only the patient owner may update seen_by_patient_at.';

REVOKE ALL ON FUNCTION public.mark_chart_snapshot_seen (uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_chart_snapshot_seen (uuid) TO authenticated;
