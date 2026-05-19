-- Fix get_chart_series: PL/pgSQL loop variable `elem` conflicted with CTE alias `elem`
-- (PostgreSQL error 42702: column reference "elem" is ambiguous).

CREATE OR REPLACE FUNCTION public.get_chart_series (
  p_user_id uuid,
  p_series jsonb,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text,
  p_timezone text
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
  elem jsonb;
  sid text;
  stype text;
  rtype text;
  is_bp boolean;
  seen_series_ids text[] := ARRAY[]::text[];
  symptom_match text[];
  hm_suffix text;
  tz text;
BEGIN
  tz := nullif(trim(p_timezone), '');

  IF tz IS NULL THEN
    RAISE EXCEPTION 'get_chart_series: p_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = tz
  ) THEN
    RAISE EXCEPTION 'get_chart_series: invalid IANA timezone %', tz
      USING ERRCODE = '22023';
  END IF;

  IF p_bucket IS NULL OR p_bucket NOT IN ('day', 'week', 'month') THEN
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

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_chart_series: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_chart_series: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  FOR elem IN
    SELECT value
    FROM jsonb_array_elements(p_series)
  LOOP
    IF jsonb_typeof(elem) <> 'object' THEN
      RAISE EXCEPTION 'get_chart_series: each p_series element must be a JSON object'
        USING ERRCODE = '22023';
    END IF;

    IF NOT (
      elem ? 'series_id'
      AND elem ? 'series_type'
      AND elem ? 'response_type'
      AND elem ? 'is_blood_pressure'
    ) THEN
      RAISE EXCEPTION 'get_chart_series: each p_series element must include series_id, series_type, response_type, and is_blood_pressure'
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(elem -> 'is_blood_pressure') <> 'boolean' THEN
      RAISE EXCEPTION 'get_chart_series: is_blood_pressure must be a JSON boolean'
        USING ERRCODE = '22023';
    END IF;

    sid := nullif(trim(elem ->> 'series_id'), '');
    stype := nullif(trim(elem ->> 'series_type'), '');
    rtype := nullif(trim(elem ->> 'response_type'), '');
    is_bp := (elem ->> 'is_blood_pressure')::boolean;

    IF sid IS NULL OR stype IS NULL OR rtype IS NULL THEN
      RAISE EXCEPTION 'get_chart_series: series_id, series_type, and response_type must be non-empty strings'
        USING ERRCODE = '22023';
    END IF;

    IF sid <> lower(sid) THEN
      RAISE EXCEPTION 'get_chart_series: series_id must be lowercase (manifest format) %', sid
        USING ERRCODE = '22023';
    END IF;

    IF sid = ANY (seen_series_ids) THEN
      RAISE EXCEPTION 'get_chart_series: duplicate series_id %', sid
        USING ERRCODE = '22023';
    END IF;

    seen_series_ids := array_append(seen_series_ids, sid);

    IF stype = 'health_marker' THEN
      IF rtype <> 'numeric' THEN
        RAISE EXCEPTION 'get_chart_series: health_marker series % requires response_type numeric', sid
          USING ERRCODE = '22023';
      END IF;

      IF NOT starts_with(sid, 'health_marker::')
        OR length(sid) <= length('health_marker::') THEN
        RAISE EXCEPTION 'get_chart_series: invalid health_marker series_id %', sid
          USING ERRCODE = '22023';
      END IF;

      hm_suffix := substring(sid FROM length('health_marker::') + 1);

      IF is_bp AND hm_suffix <> 'blood_pressure' THEN
        RAISE EXCEPTION 'get_chart_series: is_blood_pressure true requires series_id health_marker::blood_pressure'
          USING ERRCODE = '22023';
      END IF;

      IF NOT is_bp AND hm_suffix = 'blood_pressure' THEN
        RAISE EXCEPTION 'get_chart_series: health_marker::blood_pressure requires is_blood_pressure true'
          USING ERRCODE = '22023';
      END IF;
    ELSIF stype = 'symptom' THEN
      IF rtype NOT IN ('boolean', 'severity') THEN
        RAISE EXCEPTION 'get_chart_series: symptom series % requires response_type boolean or severity', sid
          USING ERRCODE = '22023';
      END IF;

      IF is_bp THEN
        RAISE EXCEPTION 'get_chart_series: symptom series must have is_blood_pressure false'
          USING ERRCODE = '22023';
      END IF;

      symptom_match := regexp_match(sid, '^symptom::(.+)::(boolean|severity)$');

      IF symptom_match IS NULL THEN
        RAISE EXCEPTION 'get_chart_series: invalid symptom series_id % (expected symptom::<name>::boolean|severity)', sid
          USING ERRCODE = '22023';
      END IF;

      IF symptom_match[2] <> rtype THEN
        RAISE EXCEPTION 'get_chart_series: series_id suffix must match response_type for %', sid
          USING ERRCODE = '22023';
      END IF;

      IF nullif(trim(symptom_match[1]), '') IS NULL THEN
        RAISE EXCEPTION 'get_chart_series: symptom series_id must include a non-empty symptom name'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'get_chart_series: unsupported series_type %', stype
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN QUERY
  WITH series_defs AS (
    SELECT
      series_elem->>'series_id' AS series_id,
      series_elem->>'series_type' AS series_type,
      series_elem->>'response_type' AS response_type,
      COALESCE((series_elem->>'is_blood_pressure')::boolean, false) AS is_blood_pressure
    FROM jsonb_array_elements(p_series) AS series_elem
  ),
  health_marker_defs AS (
    SELECT
      sd.series_id,
      sd.response_type,
      sd.is_blood_pressure,
      lower(regexp_replace(sd.series_id, '^health_marker::', '')) AS marker_series_key
    FROM series_defs sd
    WHERE sd.series_type = 'health_marker'
  ),
  symptom_defs AS (
    SELECT
      sd.series_id,
      sd.response_type,
      (regexp_match(sd.series_id, '^symptom::(.+)::(boolean|severity)$'))[1] AS symptom_series_key
    FROM series_defs sd
    WHERE sd.series_type = 'symptom'
  ),
  health_marker_match AS (
    SELECT
      hmd.series_id,
      hmd.is_blood_pressure,
      hm.recorded_at,
      hm.value_numeric,
      hm.systolic_numeric,
      hm.diastolic_numeric
    FROM health_marker_defs hmd
    INNER JOIN public.health_markers hm
      ON hm.user_id = p_user_id
      AND hm.recorded_at >= p_from
      AND hm.recorded_at < p_to
      AND (
        hm.marker_kind <> 'custom'
        OR nullif(trim(hm.custom_name), '') IS NOT NULL
      )
      AND (
        CASE
          WHEN hm.marker_kind = 'custom' THEN
            lower(hm.marker_kind) || '::' || lower(nullif(trim(hm.custom_name), ''))
          ELSE lower(hm.marker_kind)
        END
      ) = hmd.marker_series_key
  ),
  health_marker_bucketed AS (
    SELECT
      hmm.series_id,
      hmm.is_blood_pressure,
      hmm.value_numeric,
      hmm.systolic_numeric,
      hmm.diastolic_numeric,
      (
        date_trunc(p_bucket, hmm.recorded_at AT TIME ZONE tz)
        AT TIME ZONE tz
      ) AS bucket_start
    FROM health_marker_match hmm
  ),
  blood_pressure_buckets AS (
    SELECT
      hmb.series_id,
      hmb.bucket_start,
      NULL::numeric AS value_avg,
      NULL::numeric AS value_min,
      NULL::numeric AS value_max,
      avg(hmb.systolic_numeric) AS systolic_avg,
      avg(hmb.diastolic_numeric) AS diastolic_avg,
      NULL::bigint AS event_count
    FROM health_marker_bucketed hmb
    WHERE hmb.is_blood_pressure
    GROUP BY hmb.series_id, hmb.bucket_start
  ),
  numeric_health_marker_buckets AS (
    SELECT
      hmb.series_id,
      hmb.bucket_start,
      avg(hmb.value_numeric) AS value_avg,
      min(hmb.value_numeric) AS value_min,
      max(hmb.value_numeric) AS value_max,
      NULL::numeric AS systolic_avg,
      NULL::numeric AS diastolic_avg,
      NULL::bigint AS event_count
    FROM health_marker_bucketed hmb
    WHERE NOT hmb.is_blood_pressure
      AND hmb.value_numeric IS NOT NULL
    GROUP BY hmb.series_id, hmb.bucket_start
  ),
  symptom_boolean_buckets AS (
    SELECT
      sd.series_id,
      (
        date_trunc(p_bucket, es.created_at AT TIME ZONE tz)
        AT TIME ZONE tz
      ) AS bucket_start,
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
      AND es.created_at < p_to
      AND lower(nullif(trim(es.symptom_name), '')) = sd.symptom_series_key
      AND es.response_type = 'yes_no'
    WHERE sd.response_type = 'boolean'
    GROUP BY
      sd.series_id,
      date_trunc(p_bucket, es.created_at AT TIME ZONE tz) AT TIME ZONE tz
  ),
  symptom_severity_buckets AS (
    SELECT
      sd.series_id,
      (
        date_trunc(p_bucket, es.created_at AT TIME ZONE tz)
        AT TIME ZONE tz
      ) AS bucket_start,
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
      AND es.created_at < p_to
      AND lower(nullif(trim(es.symptom_name), '')) = sd.symptom_series_key
      AND es.response_type = 'severity_scale'
    WHERE sd.response_type = 'severity'
    GROUP BY
      sd.series_id,
      date_trunc(p_bucket, es.created_at AT TIME ZONE tz) AT TIME ZONE tz
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

COMMENT ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text, text) IS
'Returns pre-bucketed chart series for p_user_id and selected manifest series. Buckets use date_trunc in p_timezone (IANA name, validated against pg_timezone_names) so bucket_start aligns with chart labels formatted in that same zone (caller-supplied; e.g. patient IANA from profile or viewer browser when no stored patient zone). Validates p_bucket (day|week|month), p_series (1–3 series), and p_from < p_to (p_to exclusive). Severity: value_* ignores NULL response_severity; event_count is total severity_scale rows per bucket. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chart_series (uuid, jsonb, timestamptz, timestamptz, text, text) TO authenticated;
