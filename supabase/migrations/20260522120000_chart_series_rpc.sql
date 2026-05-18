-- Chart builder time-series: pre-bucketed aggregates for 1–3 selected series (SECURITY INVOKER).

CREATE OR REPLACE FUNCTION public.get_chart_series (
  p_user_id uuid,
  p_series jsonb,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text
)
RETURNS TABLE (
  series_id text,
  bucket_start timestamptz,
  value_avg numeric,
  value_min numeric,
  value_max numeric,
  systolic_avg numeric,
  diastolic_avg numeric,
  event_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  series_count int;
BEGIN
  IF p_bucket NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'get_chart_series: p_bucket must be day, week, or month'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_series) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'get_chart_series: p_series must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  series_count := jsonb_array_length(p_series);

  IF series_count < 1 OR series_count > 3 THEN
    RAISE EXCEPTION 'get_chart_series: p_series must contain 1 to 3 series'
      USING ERRCODE = '22023';
  END IF;

  IF p_from > p_to THEN
    RAISE EXCEPTION 'get_chart_series: p_from must be less than or equal to p_to'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH series_defs AS (
    SELECT
      elem->>'series_id' AS series_id,
      elem->>'series_type' AS series_type,
      elem->>'response_type' AS response_type,
      COALESCE((elem->>'is_blood_pressure')::boolean, false) AS is_blood_pressure
    FROM jsonb_array_elements(p_series) AS elem
  ),
  health_marker_defs AS (
    SELECT
      sd.series_id,
      sd.response_type,
      sd.is_blood_pressure,
      regexp_replace(sd.series_id, '^health_marker::', '') AS marker_series_key
    FROM series_defs sd
    WHERE sd.series_type = 'health_marker'
  ),
  symptom_defs AS (
    SELECT
      sd.series_id,
      sd.response_type,
      split_part(regexp_replace(sd.series_id, '^symptom::', ''), '::', 1) AS symptom_series_key
    FROM series_defs sd
    WHERE sd.series_type = 'symptom'
  ),
  health_marker_match AS (
    SELECT
      hm.*,
      CASE
        WHEN hm.marker_kind = 'custom' THEN
          lower(hm.marker_kind) || '::' || lower(nullif(trim(hm.custom_name), ''))
        ELSE lower(hm.marker_kind)
      END AS row_series_key
    FROM public.health_markers hm
    WHERE hm.user_id = p_user_id
      AND hm.recorded_at >= p_from
      AND hm.recorded_at <= p_to
      AND (
        hm.marker_kind <> 'custom'
        OR nullif(trim(hm.custom_name), '') IS NOT NULL
      )
  ),
  blood_pressure_buckets AS (
    SELECT
      hmd.series_id,
      date_trunc(p_bucket, hmm.recorded_at) AS bucket_start,
      NULL::numeric AS value_avg,
      NULL::numeric AS value_min,
      NULL::numeric AS value_max,
      avg(hmm.systolic_numeric) AS systolic_avg,
      avg(hmm.diastolic_numeric) AS diastolic_avg,
      NULL::bigint AS event_count
    FROM health_marker_defs hmd
    INNER JOIN health_marker_match hmm
      ON hmm.row_series_key = hmd.marker_series_key
    WHERE hmd.is_blood_pressure
    GROUP BY hmd.series_id, date_trunc(p_bucket, hmm.recorded_at)
  ),
  numeric_health_marker_buckets AS (
    SELECT
      hmd.series_id,
      date_trunc(p_bucket, hmm.recorded_at) AS bucket_start,
      avg(hmm.value_numeric) AS value_avg,
      min(hmm.value_numeric) AS value_min,
      max(hmm.value_numeric) AS value_max,
      NULL::numeric AS systolic_avg,
      NULL::numeric AS diastolic_avg,
      NULL::bigint AS event_count
    FROM health_marker_defs hmd
    INNER JOIN health_marker_match hmm
      ON hmm.row_series_key = hmd.marker_series_key
    WHERE NOT hmd.is_blood_pressure
      AND hmd.response_type = 'numeric'
      AND hmm.value_numeric IS NOT NULL
    GROUP BY hmd.series_id, date_trunc(p_bucket, hmm.recorded_at)
  ),
  symptom_boolean_buckets AS (
    SELECT
      sd.series_id,
      date_trunc(p_bucket, es.created_at) AS bucket_start,
      NULL::numeric AS value_avg,
      NULL::numeric AS value_min,
      NULL::numeric AS value_max,
      NULL::numeric AS systolic_avg,
      NULL::numeric AS diastolic_avg,
      count(*) FILTER (WHERE es.response_boolean IS TRUE)::bigint AS event_count
    FROM symptom_defs sd
    INNER JOIN public.episode_symptoms es
      ON es.user_id = p_user_id
      AND es.created_at >= p_from
      AND es.created_at <= p_to
      AND lower(nullif(trim(es.symptom_name), '')) = sd.symptom_series_key
      AND es.response_type = 'yes_no'
    WHERE sd.response_type = 'boolean'
    GROUP BY sd.series_id, date_trunc(p_bucket, es.created_at)
  ),
  symptom_severity_buckets AS (
    SELECT
      sd.series_id,
      date_trunc(p_bucket, es.created_at) AS bucket_start,
      avg(es.response_severity) AS value_avg,
      min(es.response_severity) AS value_min,
      max(es.response_severity) AS value_max,
      NULL::numeric AS systolic_avg,
      NULL::numeric AS diastolic_avg,
      count(*)::bigint AS event_count
    FROM symptom_defs sd
    INNER JOIN public.episode_symptoms es
      ON es.user_id = p_user_id
      AND es.created_at >= p_from
      AND es.created_at <= p_to
      AND lower(nullif(trim(es.symptom_name), '')) = sd.symptom_series_key
      AND es.response_type = 'severity_scale'
    WHERE sd.response_type = 'severity'
    GROUP BY sd.series_id, date_trunc(p_bucket, es.created_at)
  )
  SELECT * FROM blood_pressure_buckets
  UNION ALL
  SELECT * FROM numeric_health_marker_buckets
  UNION ALL
  SELECT * FROM symptom_boolean_buckets
  UNION ALL
  SELECT * FROM symptom_severity_buckets
  ORDER BY 1, 2;
END;
$$;

COMMENT ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) IS
'Returns pre-bucketed chart series for p_user_id and selected manifest series (health markers and symptoms). Validates p_bucket (day|week|month), p_series length (1–3), and p_from <= p_to. Severity series: value_avg/min/max ignore NULL response_severity; event_count is total severity_scale rows in the bucket (symptom logging frequency per PRD §9). SECURITY INVOKER: RLS on health_markers and episode_symptoms applies.';

REVOKE ALL ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) TO authenticated;
