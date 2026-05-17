-- Chart builder manifest: chartable series metadata per patient without raw observation rows.

CREATE OR REPLACE FUNCTION public.get_user_chart_manifest (p_user_id uuid)
RETURNS TABLE (
  series_id text,
  series_type text,
  label text,
  response_type text,
  is_blood_pressure boolean,
  unit text,
  observation_count bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH health_marker_rows AS (
    SELECT
      lower(coalesce(hm.custom_name, hm.marker_kind)) AS series_key,
      coalesce(hm.custom_name, hm.marker_kind) AS label,
      (
        hm.value_numeric IS NOT NULL
        OR hm.systolic_numeric IS NOT NULL
      ) AS is_numeric_observation,
      (hm.marker_kind = 'blood_pressure') AS row_is_blood_pressure,
      hm.custom_unit,
      hm.recorded_at
    FROM public.health_markers hm
    WHERE hm.user_id = p_user_id
  ),
  health_marker_series AS (
    SELECT
      'health_marker::' || hmr.series_key AS series_id,
      'health_marker'::text AS series_type,
      hmr.label,
      CASE
        WHEN bool_or(hmr.is_numeric_observation) THEN 'numeric'
        ELSE 'text'
      END AS response_type,
      bool_or(hmr.row_is_blood_pressure) AS is_blood_pressure,
      max(hmr.custom_unit) AS unit,
      count(*)::bigint AS observation_count,
      min(hmr.recorded_at) AS first_observed_at,
      max(hmr.recorded_at) AS last_observed_at
    FROM health_marker_rows hmr
    GROUP BY hmr.series_key, hmr.label
  ),
  symptom_rows AS (
    SELECT
      lower(es.symptom_name) AS series_key,
      es.symptom_name AS label,
      CASE es.response_type
        WHEN 'yes_no' THEN 'boolean'
        WHEN 'severity_scale' THEN 'severity'
        WHEN 'free_text' THEN 'text'
        WHEN 'photo' THEN 'text'
        WHEN 'video' THEN 'text'
      END AS chart_response_type,
      es.created_at
    FROM public.episode_symptoms es
    WHERE es.user_id = p_user_id
  ),
  symptom_series AS (
    SELECT
      'symptom::' || sr.series_key AS series_id,
      'symptom'::text AS series_type,
      sr.label,
      max(sr.chart_response_type) AS response_type,
      false AS is_blood_pressure,
      NULL::text AS unit,
      count(*)::bigint AS observation_count,
      min(sr.created_at) AS first_observed_at,
      max(sr.created_at) AS last_observed_at
    FROM symptom_rows sr
    WHERE sr.chart_response_type <> 'text'
    GROUP BY sr.series_key, sr.label
  )
  SELECT
    m.series_id,
    m.series_type,
    m.label,
    m.response_type,
    m.is_blood_pressure,
    m.unit,
    m.observation_count,
    m.first_observed_at,
    m.last_observed_at
  FROM (
    SELECT * FROM health_marker_series
    UNION ALL
    SELECT * FROM symptom_series
  ) m
  ORDER BY m.series_type, m.label ASC;
$$;

COMMENT ON FUNCTION public.get_user_chart_manifest (uuid) IS
'Returns chartable observation series for p_user_id (health markers and yes_no/severity symptoms). SECURITY INVOKER: RLS on health_markers and episode_symptoms applies; practitioners need an active practitioner_access grant.';

REVOKE ALL ON FUNCTION public.get_user_chart_manifest (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_chart_manifest (uuid) TO authenticated;
