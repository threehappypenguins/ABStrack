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
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH series_defs AS (
    SELECT
      elem->>'series_id' AS series_id,
      elem->>'series_type' AS series_type,
      elem->>'response_type' AS response_type,
      COALESCE((elem->>'is_blood_pressure')::boolean, false) AS is_blood_pressure
    FROM jsonb_array_elements(COALESCE(p_series, '[]'::jsonb)) AS elem
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
$$;

COMMENT ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) IS
'Returns pre-bucketed chart series for p_user_id and selected manifest series (health markers and symptoms). SECURITY INVOKER: RLS on health_markers and episode_symptoms applies.';

REVOKE ALL ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text) TO authenticated;
