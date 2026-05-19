-- Follow-up to 20260524130000_chart_snapshots.sql (already applied on main/cloud).
-- Trusted-session DELETE for dev cleanup; app clients remain append-only.

COMMENT ON COLUMN public.chart_snapshots.date_from IS 'Inclusive chart range start (ISO timestamptz; matches get_chart_series p_from).';

COMMENT ON COLUMN public.chart_snapshots.date_to IS 'Exclusive chart range end (ISO timestamptz; matches get_chart_series p_to).';

ALTER TABLE public.chart_snapshots
  ADD CONSTRAINT chart_snapshots_date_range_chk CHECK (date_from < date_to);

ALTER TABLE public.chart_snapshots
  ADD COLUMN chart_timezone text;

COMMENT ON COLUMN public.chart_snapshots.chart_timezone IS 'IANA timezone used when the practitioner built the chart (matches get_chart_series p_timezone). Nullable for rows created before this column existed.';

-- ---------------------------------------------------------------------------
-- chart_timezone: table-level IANA validation (direct INSERT and RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chart_snapshots_normalize_chart_timezone (p_chart_timezone text)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := nullif(trim(p_chart_timezone), '');

  IF v_tz IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT
      1
    FROM
      pg_catalog.pg_timezone_names
    WHERE
      name = v_tz) THEN
    RAISE EXCEPTION 'chart_snapshots.chart_timezone: invalid IANA timezone %', v_tz
      USING ERRCODE = '22023';
  END IF;

  RETURN v_tz;
END;
$$;

COMMENT ON FUNCTION public.chart_snapshots_normalize_chart_timezone (text) IS 'Trims chart_snapshots.chart_timezone; null/blank → NULL; non-empty values must exist in pg_timezone_names.';

CREATE OR REPLACE FUNCTION public.chart_snapshots_chart_timezone_guard ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.chart_timezone := public.chart_snapshots_normalize_chart_timezone (NEW.chart_timezone);

  IF TG_OP = 'INSERT'
    AND NEW.chart_timezone IS NULL THEN
    RAISE EXCEPTION 'chart_snapshots.chart_timezone is required on insert'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.chart_snapshots_chart_timezone_guard () IS 'BEFORE INSERT/UPDATE: valid IANA when set; INSERT requires non-null chart_timezone (legacy rows may keep null on UPDATE).';

CREATE TRIGGER chart_snapshots_chart_timezone
  BEFORE INSERT OR UPDATE ON public.chart_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.chart_snapshots_chart_timezone_guard ();

-- ---------------------------------------------------------------------------
-- share_chart_snapshot: replace six-arg RPC with chart_timezone (seven-arg)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION public.share_chart_snapshot (
  p_patient_user_id uuid,
  p_series_definition jsonb,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_bucket text,
  p_chart_timezone text,
  p_practitioner_note text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid;
  v_tz text;
BEGIN
  IF NOT public.user_has_practitioner_access (p_patient_user_id) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_bucket IS NULL
    OR p_bucket NOT IN ('day', 'week', 'month') THEN
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

  v_tz := public.chart_snapshots_normalize_chart_timezone (p_chart_timezone);

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'p_chart_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.chart_snapshots (
    patient_user_id,
    practitioner_user_id,
    series_definition,
    date_from,
    date_to,
    bucket,
    practitioner_note,
    chart_timezone)
  VALUES (
    p_patient_user_id,
    (SELECT auth.uid ()),
    p_series_definition,
    p_date_from,
    p_date_to,
    p_bucket,
    NULLIF (trim(p_practitioner_note), ''),
    v_tz)
  RETURNING
    id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text, text) IS 'Practitioner shares a chart snapshot with a linked patient. Args: bucket, chart_timezone (IANA, required), optional note. Replaces the six-argument function from 20260524130000.';

REVOKE ALL ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.share_chart_snapshot (uuid, jsonb, timestamptz, timestamptz, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chart_snapshots_append_only_guard ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.profiles_trusted_session_for_app_role () THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'chart_snapshots is append-only'
      USING HINT = 'Use the SQL Editor as postgres, or call delete_chart_snapshots_maintenance from a trusted session.';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (to_jsonb(OLD) - 'seen_by_patient_at') = (to_jsonb(NEW) - 'seen_by_patient_at')
    AND OLD.seen_by_patient_at IS NULL
    AND NEW.seen_by_patient_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'chart_snapshots is append-only except seen_by_patient_at';
END;
$$;

COMMENT ON FUNCTION public.chart_snapshots_append_only_guard () IS 'Blocks DELETE for app sessions; allows DELETE when profiles_trusted_session_for_app_role() (postgres SQL Editor or service_role). UPDATE only for one-time seen_by_patient_at.';

CREATE OR REPLACE FUNCTION public.delete_chart_snapshots_maintenance (
  p_snapshot_id uuid DEFAULT NULL,
  p_patient_user_id uuid DEFAULT NULL
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF NOT public.profiles_trusted_session_for_app_role () THEN
    RAISE EXCEPTION 'delete_chart_snapshots_maintenance requires a trusted session (postgres or service_role)'
      USING ERRCODE = '42501';
  END IF;

  IF p_snapshot_id IS NOT NULL THEN
    DELETE FROM public.chart_snapshots
    WHERE id = p_snapshot_id;
  ELSIF p_patient_user_id IS NOT NULL THEN
    DELETE FROM public.chart_snapshots
    WHERE patient_user_id = p_patient_user_id;
  ELSE
    DELETE FROM public.chart_snapshots;
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_chart_snapshots_maintenance (uuid, uuid) IS 'Trusted-session maintenance only: delete one snapshot, all for a patient, or all rows when both args are NULL. Not granted to authenticated.';

REVOKE ALL ON FUNCTION public.delete_chart_snapshots_maintenance (uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.delete_chart_snapshots_maintenance (uuid, uuid) TO service_role;
