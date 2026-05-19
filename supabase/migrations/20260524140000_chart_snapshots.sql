-- Follow-up to 20260524130000_chart_snapshots.sql (already applied on main/cloud).
-- Trusted-session DELETE for dev cleanup; app clients remain append-only.

COMMENT ON COLUMN public.chart_snapshots.date_from IS 'Inclusive chart range start (ISO timestamptz; matches get_chart_series p_from).';

COMMENT ON COLUMN public.chart_snapshots.date_to IS 'Exclusive chart range end (ISO timestamptz; matches get_chart_series p_to).';

ALTER TABLE public.chart_snapshots
  ADD CONSTRAINT chart_snapshots_date_range_chk CHECK (date_from < date_to);

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
