-- Curated insights overview RPCs for patient and practitioner web insights surfaces.

CREATE OR REPLACE FUNCTION public.get_episode_summary (
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text
)
RETURNS TABLE (
  total_episode_count bigint,
  abs_episode_count bigint,
  other_episode_count bigint,
  average_episodes_per_week numeric,
  longest_episode_free_streak_days integer,
  current_episode_free_streak_days integer,
  average_episode_duration_hours numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tz text;
BEGIN
  tz := nullif(trim(p_timezone), '');

  IF tz IS NULL THEN
    RAISE EXCEPTION 'get_episode_summary: p_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = tz
  ) THEN
    RAISE EXCEPTION 'get_episode_summary: invalid IANA timezone %', tz
      USING ERRCODE = '22023';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_episode_summary: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_episode_summary: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH range_bounds AS (
    SELECT
      (p_from AT TIME ZONE tz)::date AS range_start_date,
      GREATEST(
        (p_from AT TIME ZONE tz)::date,
        ((p_to AT TIME ZONE tz) - interval '1 microsecond')::date
      ) AS range_end_date
  ),
  episodes_started AS (
    SELECT
      e.id,
      e.episode_type,
      e.started_at,
      e.ended_at
    FROM public.episodes e
    WHERE e.user_id = p_user_id
      AND e.started_at >= p_from
      AND e.started_at < p_to
  ),
  episodes_overlapping AS (
    SELECT
      GREATEST(
        (e.started_at AT TIME ZONE tz)::date,
        rb.range_start_date
      ) AS overlap_start_date,
      LEAST(
        coalesce((e.ended_at AT TIME ZONE tz)::date, rb.range_end_date),
        rb.range_end_date
      ) AS overlap_end_date
    FROM public.episodes e
    CROSS JOIN range_bounds rb
    WHERE e.user_id = p_user_id
      AND e.started_at < p_to
      AND coalesce(e.ended_at, p_to) > p_from
  ),
  occupied_days AS (
    SELECT DISTINCT gs::date AS occupied_date
    FROM episodes_overlapping eo
    CROSS JOIN LATERAL generate_series(
      eo.overlap_start_date,
      eo.overlap_end_date,
      '1 day'::interval
    ) AS gs
    WHERE eo.overlap_start_date <= eo.overlap_end_date
  ),
  selected_days AS (
    SELECT gs::date AS calendar_date
    FROM range_bounds rb
    CROSS JOIN LATERAL generate_series(
      rb.range_start_date,
      rb.range_end_date,
      '1 day'::interval
    ) AS gs
  ),
  free_days AS (
    SELECT sd.calendar_date
    FROM selected_days sd
    LEFT JOIN occupied_days od
      ON od.occupied_date = sd.calendar_date
    WHERE od.occupied_date IS NULL
  ),
  free_day_groups AS (
    SELECT
      fd.calendar_date,
      fd.calendar_date - row_number() OVER (ORDER BY fd.calendar_date)::integer
        AS streak_group
    FROM free_days fd
  ),
  free_day_streaks AS (
    SELECT
      count(*)::integer AS streak_days,
      max(calendar_date) AS streak_end_date
    FROM free_day_groups
    GROUP BY streak_group
  ),
  period_summary AS (
    SELECT
      (rb.range_end_date - rb.range_start_date + 1)::integer AS period_day_count,
      rb.range_end_date
    FROM range_bounds rb
  ),
  episode_counts AS (
    SELECT
      count(*)::bigint AS total_episode_count,
      count(*) FILTER (WHERE es.episode_type = 'ABS')::bigint AS abs_episode_count,
      count(*) FILTER (WHERE es.episode_type = 'Other')::bigint AS other_episode_count
    FROM episodes_started es
  ),
  duration_summary AS (
    SELECT round(
      avg(extract(epoch FROM (es.ended_at - es.started_at)) / 3600.0)::numeric,
      1
    ) AS average_episode_duration_hours
    FROM episodes_started es
    WHERE es.ended_at IS NOT NULL
      AND es.ended_at > es.started_at
  ),
  streak_summary AS (
    SELECT
      coalesce((SELECT max(fds.streak_days) FROM free_day_streaks fds), 0) AS longest_episode_free_streak_days,
      coalesce((
        SELECT fds.streak_days
        FROM free_day_streaks fds
        CROSS JOIN period_summary ps
        WHERE fds.streak_end_date = ps.range_end_date
        ORDER BY fds.streak_days DESC
        LIMIT 1
      ), 0) AS current_episode_free_streak_days
  )
  SELECT
    ec.total_episode_count,
    ec.abs_episode_count,
    ec.other_episode_count,
    round((ec.total_episode_count::numeric * 7) / ps.period_day_count::numeric, 1)
      AS average_episodes_per_week,
    ss.longest_episode_free_streak_days,
    ss.current_episode_free_streak_days,
    ds.average_episode_duration_hours
  FROM episode_counts ec
  CROSS JOIN period_summary ps
  CROSS JOIN duration_summary ds
  CROSS JOIN streak_summary ss;
END;
$$;

COMMENT ON FUNCTION public.get_episode_summary (uuid, timestamptz, timestamptz, text) IS
'Returns overview metrics for episodes started within the selected range: totals by type, average episodes per week, longest/current episode-free streaks based on patient-local calendar days, and average episode duration in hours. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.get_episode_summary (uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_summary (uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_episode_week_counts (
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text
)
RETURNS TABLE (
  week_start timestamptz,
  episode_type text,
  episode_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tz text;
BEGIN
  tz := nullif(trim(p_timezone), '');

  IF tz IS NULL THEN
    RAISE EXCEPTION 'get_episode_week_counts: p_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = tz
  ) THEN
    RAISE EXCEPTION 'get_episode_week_counts: invalid IANA timezone %', tz
      USING ERRCODE = '22023';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_episode_week_counts: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_episode_week_counts: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    (
      date_trunc('week', e.started_at AT TIME ZONE tz)
      AT TIME ZONE tz
    ) AS week_start,
    e.episode_type,
    count(*)::bigint AS episode_count
  FROM public.episodes e
  WHERE e.user_id = p_user_id
    AND e.started_at >= p_from
    AND e.started_at < p_to
  GROUP BY
    date_trunc('week', e.started_at AT TIME ZONE tz) AT TIME ZONE tz,
    e.episode_type
  ORDER BY week_start, e.episode_type;
END;
$$;

COMMENT ON FUNCTION public.get_episode_week_counts (uuid, timestamptz, timestamptz, text) IS
'Returns weekly episode counts grouped by episode_type for the selected range. Buckets use date_trunc in p_timezone (IANA name) so patient and practitioner charts align to the same local week boundaries. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.get_episode_week_counts (uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_week_counts (uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_episode_start_hour_distribution (
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text
)
RETURNS TABLE (
  hour_of_day integer,
  episode_type text,
  episode_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tz text;
BEGIN
  tz := nullif(trim(p_timezone), '');

  IF tz IS NULL THEN
    RAISE EXCEPTION 'get_episode_start_hour_distribution: p_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = tz
  ) THEN
    RAISE EXCEPTION 'get_episode_start_hour_distribution: invalid IANA timezone %', tz
      USING ERRCODE = '22023';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_episode_start_hour_distribution: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_episode_start_hour_distribution: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    extract(hour FROM (e.started_at AT TIME ZONE tz))::integer AS hour_of_day,
    e.episode_type,
    count(*)::bigint AS episode_count
  FROM public.episodes e
  WHERE e.user_id = p_user_id
    AND e.started_at >= p_from
    AND e.started_at < p_to
  GROUP BY
    extract(hour FROM (e.started_at AT TIME ZONE tz))::integer,
    e.episode_type
  ORDER BY hour_of_day, e.episode_type;
END;
$$;

COMMENT ON FUNCTION public.get_episode_start_hour_distribution (uuid, timestamptz, timestamptz, text) IS
'Returns hourly episode-start counts grouped by episode_type for the selected range. Hours are extracted in p_timezone (IANA name) so clustering callouts reflect patient-local time of day. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.get_episode_start_hour_distribution (uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_episode_start_hour_distribution (uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_symptom_frequency (
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  symptom_name text,
  occurrence_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_symptom_frequency: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_symptom_frequency: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH symptom_rows AS (
    SELECT
      lower(nullif(trim(es.symptom_name), '')) AS symptom_key,
      nullif(trim(es.symptom_name), '') AS symptom_label,
      CASE
        WHEN es.response_type = 'yes_no' AND es.response_boolean IS TRUE THEN 1
        WHEN es.response_type = 'severity_scale' THEN 1
        ELSE 0
      END AS occurrence_value
    FROM public.episode_symptoms es
    WHERE es.user_id = p_user_id
      AND es.created_at >= p_from
      AND es.created_at < p_to
      AND nullif(trim(es.symptom_name), '') IS NOT NULL
      AND es.response_type IN ('yes_no', 'severity_scale')
  )
  SELECT
    min(sr.symptom_label) AS symptom_name,
    sum(sr.occurrence_value)::bigint AS occurrence_count
  FROM symptom_rows sr
  GROUP BY sr.symptom_key
  HAVING sum(sr.occurrence_value) > 0
  ORDER BY occurrence_count DESC, symptom_name ASC;
END;
$$;

COMMENT ON FUNCTION public.get_symptom_frequency (uuid, timestamptz, timestamptz) IS
'Returns ranked symptom counts for the selected range. Boolean symptoms count only true responses; severity symptoms count each logged observation. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.get_symptom_frequency (uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_symptom_frequency (uuid, timestamptz, timestamptz) TO authenticated;
