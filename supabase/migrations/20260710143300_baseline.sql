


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."access_log_prevent_update_or_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'access_log is append-only';
  END IF;

  -- UPDATE: allow only auth.users FK ON DELETE SET NULL on actor_user_id / patient_user_id.
  -- Compare all non-FK columns via jsonb (schema-evolution safe); FK columns only unchanged or nulling.
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(OLD) - 'actor_user_id' - 'patient_user_id') = (to_jsonb(NEW) - 'actor_user_id' - 'patient_user_id')
    AND (
      OLD.actor_user_id IS NOT DISTINCT FROM NEW.actor_user_id
      OR (OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL)
    )
    AND (
      OLD.patient_user_id IS NOT DISTINCT FROM NEW.patient_user_id
      OR (OLD.patient_user_id IS NOT NULL AND NEW.patient_user_id IS NULL)
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'access_log is append-only';
END;
$$;


ALTER FUNCTION "public"."access_log_prevent_update_or_delete"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."access_log_prevent_update_or_delete"() IS 'Blocks UPDATE/DELETE except FK SET NULL on actor_user_id/patient_user_id; non-FK columns compared via jsonb minus those keys (new columns covered automatically).';



CREATE OR REPLACE FUNCTION "public"."assert_episode_child_not_after_episode_end"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  new_ep_ended timestamptz;
  new_eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  new_eid := NEW.episode_id;
  IF new_eid IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT
    e.ended_at INTO new_ep_ended
  FROM
    public.episodes e
  WHERE
    e.id = new_eid
  FOR SHARE;
  IF new_ep_ended IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'This episode has ended. You cannot add or change entries for it.' USING
      ERRCODE = 'check_violation';
END;
$$;


ALTER FUNCTION "public"."assert_episode_child_not_after_episode_end"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assert_episode_child_not_after_episode_end"() IS 'Blocks INSERT/UPDATE when NEW.episode_id points at an ended episode. UPDATE paths that detach rows (NEW.episode_id is null), including FK ON DELETE SET NULL, are allowed. DELETE is allowed.';



CREATE OR REPLACE FUNCTION "public"."chart_snapshots_append_only_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."chart_snapshots_append_only_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."chart_snapshots_append_only_guard"() IS 'Blocks DELETE for app sessions; allows DELETE when profiles_trusted_session_for_app_role() (postgres SQL Editor or service_role). UPDATE only for one-time seen_by_patient_at.';



CREATE OR REPLACE FUNCTION "public"."chart_snapshots_chart_timezone_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."chart_snapshots_chart_timezone_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."chart_snapshots_chart_timezone_guard"() IS 'BEFORE INSERT/UPDATE: valid IANA when set; INSERT requires non-null chart_timezone (legacy rows may keep null on UPDATE).';



CREATE OR REPLACE FUNCTION "public"."chart_snapshots_normalize_chart_timezone"("p_chart_timezone" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
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


ALTER FUNCTION "public"."chart_snapshots_normalize_chart_timezone"("p_chart_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."chart_snapshots_normalize_chart_timezone"("p_chart_timezone" "text") IS 'Trims chart_snapshots.chart_timezone; null/blank → NULL; non-empty values must exist in pg_timezone_names.';



CREATE OR REPLACE FUNCTION "public"."delete_chart_snapshots_maintenance"("p_snapshot_id" "uuid" DEFAULT NULL::"uuid", "p_patient_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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


ALTER FUNCTION "public"."delete_chart_snapshots_maintenance"("p_snapshot_id" "uuid", "p_patient_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_chart_snapshots_maintenance"("p_snapshot_id" "uuid", "p_patient_user_id" "uuid") IS 'Trusted-session maintenance only: delete one snapshot, all for a patient, or all rows when both args are NULL. Not granted to authenticated.';



CREATE OR REPLACE FUNCTION "public"."enforce_caretaker_access_profile_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.patient_user_id
      AND p.app_role = 'patient') THEN
    RAISE EXCEPTION 'caretaker_access.patient_user_id must reference a profile with app_role patient';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.caretaker_user_id
      AND p.app_role = 'caretaker') THEN
    RAISE EXCEPTION 'caretaker_access.caretaker_user_id must reference a profile with app_role caretaker';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_caretaker_access_profile_roles"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_caretaker_access_profile_roles"() IS 'Ensures caretaker grants only link patient + caretaker profiles per PRD; runs under definer to read profiles despite RLS.';



CREATE OR REPLACE FUNCTION "public"."enforce_episode_preset_owners"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.symptom_preset_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.symptom_presets s
      WHERE
        s.id = NEW.symptom_preset_id
        AND s.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'episodes.symptom_preset_id must reference a preset owned by user_id';
    END IF;
  END IF;
  IF NEW.health_marker_preset_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.health_marker_presets h
      WHERE
        h.id = NEW.health_marker_preset_id
        AND h.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'episodes.health_marker_preset_id must reference a preset owned by user_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_episode_preset_owners"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_episode_preset_owners"() IS 'Ensures episode symptom_preset_id and health_marker_preset_id reference presets owned by episodes.user_id.';



CREATE OR REPLACE FUNCTION "public"."enforce_episode_template_preset_owners"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.symptom_presets s
    WHERE
      s.id = NEW.symptom_preset_id
      AND s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'episode_templates.symptom_preset_id must reference a preset owned by user_id';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.health_marker_presets h
    WHERE
      h.id = NEW.health_marker_preset_id
      AND h.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'episode_templates.health_marker_preset_id must reference a preset owned by user_id';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_episode_template_preset_owners"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_episode_template_preset_owners"() IS 'Ensures episode_templates preset FKs (both required) reference presets owned by episode_templates.user_id.';



CREATE OR REPLACE FUNCTION "public"."enforce_food_diary_episode_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.episode_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.episodes e
      WHERE e.id = NEW.episode_id
        AND e.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'food_diary_entries.episode_id must reference an episode owned by user_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_food_diary_episode_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_phi_row_user_id_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    IF NOT public.profiles_trusted_session_for_app_role () THEN
      RAISE EXCEPTION '%: user_id cannot be changed on update', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_phi_row_user_id_immutable"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_phi_row_user_id_immutable"() IS 'Prevents caretaker (or patient) from moving PHI rows to another user_id; trusted session may fix data.';



CREATE OR REPLACE FUNCTION "public"."enforce_practitioner_access_profile_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.patient_user_id
      AND p.app_role = 'patient') THEN
    RAISE EXCEPTION 'practitioner_access.patient_user_id must reference a profile with app_role patient';
  END IF;
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles p
    WHERE
      p.id = NEW.practitioner_user_id
      AND p.app_role = 'practitioner') THEN
    RAISE EXCEPTION 'practitioner_access.practitioner_user_id must reference a profile with app_role practitioner';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_practitioner_access_profile_roles"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_practitioner_access_profile_roles"() IS 'Ensures practitioner grants only link patient + practitioner profiles per PRD; runs under definer to read profiles despite RLS.';



CREATE OR REPLACE FUNCTION "public"."episode_media_storage_can_select"("p_object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
    SELECT
      CASE
        WHEN v.pid IS NULL THEN FALSE
        WHEN v.pid = (SELECT auth.uid()) THEN TRUE
        WHEN public.user_is_caretaker_for_patient (v.pid) THEN TRUE
        WHEN public.user_has_practitioner_access (v.pid) THEN TRUE
        ELSE FALSE
      END
    FROM (
      SELECT
        public.episode_media_storage_path_user_id (p_object_name) AS pid) AS v;
  $$;


ALTER FUNCTION "public"."episode_media_storage_can_select"("p_object_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."episode_media_storage_can_select"("p_object_name" "text") IS 'True if current user may read/list episode-media object: owner, active caretaker, or authorized practitioner. Computes episode_media.user_id from path once.';



CREATE OR REPLACE FUNCTION "public"."episode_media_storage_can_write"("p_object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
    SELECT
      CASE
        WHEN v.pid IS NULL THEN FALSE
        WHEN v.pid = (SELECT auth.uid()) THEN TRUE
        WHEN public.user_is_caretaker_for_patient (v.pid) THEN TRUE
        ELSE FALSE
      END
    FROM (
      SELECT
        public.episode_media_storage_path_user_id (p_object_name) AS pid) AS v;
  $$;


ALTER FUNCTION "public"."episode_media_storage_can_write"("p_object_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."episode_media_storage_can_write"("p_object_name" "text") IS 'True if current user may insert/update/delete episode-media object: owner or active caretaker only. Computes episode_media.user_id from path once.';



CREATE OR REPLACE FUNCTION "public"."episode_media_storage_path_user_id"("p_object_name" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'storage', 'public'
    AS $_$
    SELECT
      CASE WHEN seg IS NOT NULL
        AND seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        seg::uuid
      ELSE
        NULL::uuid
      END
    FROM (
      SELECT
        (storage.foldername (p_object_name))[1] AS seg) s;
  $_$;


ALTER FUNCTION "public"."episode_media_storage_path_user_id"("p_object_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."episode_media_storage_path_user_id"("p_object_name" "text") IS 'Parses public.episode_media.user_id from object path: first segment must be a UUID. Keys MUST be "{user_id}/..." with that user_id per PRD §10.';



CREATE OR REPLACE FUNCTION "public"."get_chart_series"("p_user_id" "uuid", "p_series" "jsonb", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_bucket" "text", "p_timezone" "text") RETURNS TABLE("series_id" "text", "bucket_start" timestamp with time zone, "value_avg" numeric, "value_min" numeric, "value_max" numeric, "systolic_avg" numeric, "diastolic_avg" numeric, "event_count" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."get_chart_series"("p_user_id" "uuid", "p_series" "jsonb", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_bucket" "text", "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_chart_series"("p_user_id" "uuid", "p_series" "jsonb", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_bucket" "text", "p_timezone" "text") IS 'Returns pre-bucketed chart series for p_user_id and selected manifest series. Buckets use date_trunc in p_timezone (IANA name, validated against pg_timezone_names) so bucket_start aligns with chart labels formatted in that same zone (caller-supplied; e.g. patient IANA from profile or viewer browser when no stored patient zone). Validates p_bucket (day|week|month), p_series (1–3 series), and p_from < p_to (p_to exclusive). Severity: value_* ignores NULL response_severity; event_count is total severity_scale rows per bucket. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."get_episode_start_hour_distribution"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") RETURNS TABLE("hour_of_day" integer, "episode_type" "text", "episode_count" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tz text;
  range_day_count integer;
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

  range_day_count := (
    ((p_to AT TIME ZONE tz) - interval '1 microsecond')::date
    - (p_from AT TIME ZONE tz)::date
    + 1
  )::integer;

  IF range_day_count > 730 THEN
    RAISE EXCEPTION 'get_episode_start_hour_distribution: selected range must be 730 days or fewer'
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


ALTER FUNCTION "public"."get_episode_start_hour_distribution"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_episode_start_hour_distribution"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") IS 'Returns hourly episode-start counts grouped by episode_type for the selected range. Hours are extracted in p_timezone (IANA name) so clustering callouts reflect patient-local time of day. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."get_episode_summary"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") RETURNS TABLE("total_episode_count" bigint, "abs_episode_count" bigint, "other_episode_count" bigint, "average_episodes_per_week" numeric, "longest_episode_free_streak_days" integer, "current_episode_free_streak_days" integer, "average_episode_duration_hours" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tz text;
  range_day_count integer;
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

  range_day_count := (
    ((p_to AT TIME ZONE tz) - interval '1 microsecond')::date
    - (p_from AT TIME ZONE tz)::date
    + 1
  )::integer;

  IF range_day_count > 730 THEN
    RAISE EXCEPTION 'get_episode_summary: selected range must be 730 days or fewer'
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
        coalesce(
          ((e.ended_at AT TIME ZONE tz) - interval '1 microsecond')::date,
          rb.range_end_date
        ),
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


ALTER FUNCTION "public"."get_episode_summary"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_episode_summary"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") IS 'Returns overview metrics for episodes started within the selected range: totals by type, average episodes per week, longest/current episode-free streaks based on patient-local calendar days, and average episode duration in hours. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."get_episode_week_counts"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") RETURNS TABLE("week_start" timestamp with time zone, "episode_type" "text", "episode_count" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tz text;
  range_day_count integer;
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

  range_day_count := (
    ((p_to AT TIME ZONE tz) - interval '1 microsecond')::date
    - (p_from AT TIME ZONE tz)::date
    + 1
  )::integer;

  IF range_day_count > 730 THEN
    RAISE EXCEPTION 'get_episode_week_counts: selected range must be 730 days or fewer'
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


ALTER FUNCTION "public"."get_episode_week_counts"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_episode_week_counts"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") IS 'Returns weekly episode counts grouped by episode_type for the selected range. Buckets use date_trunc in p_timezone (IANA name) so patient and practitioner charts align to the same local week boundaries. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."get_symptom_frequency"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") RETURNS TABLE("symptom_name" "text", "occurrence_count" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tz text := nullif(trim(p_timezone), '');
  range_day_count integer;
BEGIN
  IF tz IS NULL THEN
    RAISE EXCEPTION 'get_symptom_frequency: p_timezone must be a non-empty IANA timezone name'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM pg_timezone_names
  WHERE name = tz;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_symptom_frequency: invalid IANA timezone %', tz
      USING ERRCODE = '22023';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_symptom_frequency: p_from and p_to must be non-null timestamps'
      USING ERRCODE = '22023';
  END IF;

  IF p_from >= p_to THEN
    RAISE EXCEPTION 'get_symptom_frequency: p_from must be less than p_to (p_to is exclusive)'
      USING ERRCODE = '22023';
  END IF;

  range_day_count := (
    ((p_to AT TIME ZONE tz) - interval '1 microsecond')::date
    - (p_from AT TIME ZONE tz)::date
    + 1
  )::integer;

  IF range_day_count > 730 THEN
    RAISE EXCEPTION 'get_symptom_frequency: selected range must be 730 days or fewer'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH symptom_rows AS (
    SELECT
      lower(nullif(trim(es.symptom_name), '')) AS symptom_key,
      nullif(trim(es.symptom_name), '') AS symptom_label,
      CASE
        WHEN es.response_type = 'yes_no' AND es.response_boolean IS TRUE THEN 1
        WHEN es.response_type = 'severity_scale'
          AND es.response_severity IS NOT NULL THEN 1
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


ALTER FUNCTION "public"."get_symptom_frequency"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_symptom_frequency"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") IS 'Returns ranked symptom counts for the selected range. The 730-day cap is validated in p_timezone (IANA name) so server-side limits match the overview date picker. Boolean symptoms count only true responses; severity symptoms count each logged observation. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."get_user_chart_manifest"("p_user_id" "uuid") RETURNS TABLE("series_id" "text", "series_type" "text", "label" "text", "response_type" "text", "is_blood_pressure" boolean, "unit" "text", "observation_count" bigint, "first_observed_at" timestamp with time zone, "last_observed_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  WITH health_marker_rows AS (
    SELECT
      CASE
        WHEN hm.marker_kind = 'custom' THEN
          lower(hm.marker_kind) || '::' || lower(nullif(trim(hm.custom_name), ''))
        ELSE lower(hm.marker_kind)
      END AS series_key,
      CASE
        WHEN hm.marker_kind = 'custom' THEN nullif(trim(hm.custom_name), '')
        ELSE coalesce(hm.custom_name, hm.marker_kind)
      END AS label,
      (
        hm.value_numeric IS NOT NULL
        OR hm.systolic_numeric IS NOT NULL
        OR hm.diastolic_numeric IS NOT NULL
      ) AS is_numeric_observation,
      (hm.marker_kind = 'blood_pressure') AS row_is_blood_pressure,
      hm.custom_unit,
      hm.recorded_at
    FROM public.health_markers hm
    WHERE hm.user_id = p_user_id
      AND (
        hm.marker_kind <> 'custom'
        OR nullif(trim(hm.custom_name), '') IS NOT NULL
      )
  ),
  health_marker_series AS (
    SELECT
      'health_marker::' || hmr.series_key AS series_id,
      'health_marker'::text AS series_type,
      min(hmr.label) AS label,
      CASE
        WHEN bool_or(hmr.is_numeric_observation) THEN 'numeric'
        ELSE 'text'
      END AS response_type,
      bool_or(hmr.row_is_blood_pressure) AS is_blood_pressure,
      CASE
        WHEN count(DISTINCT hmr.custom_unit) FILTER (WHERE hmr.custom_unit IS NOT NULL) > 1 THEN NULL
        ELSE max(hmr.custom_unit)
      END AS unit,
      count(*)::bigint AS observation_count,
      min(hmr.recorded_at) AS first_observed_at,
      max(hmr.recorded_at) AS last_observed_at
    FROM health_marker_rows hmr
    GROUP BY hmr.series_key
  ),
  symptom_rows AS (
    SELECT
      lower(nullif(trim(es.symptom_name), '')) AS series_key,
      nullif(trim(es.symptom_name), '') AS label,
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
      AND nullif(trim(es.symptom_name), '') IS NOT NULL
  ),
  symptom_series AS (
    SELECT
      'symptom::' || sr.series_key || '::' || sr.chart_response_type AS series_id,
      'symptom'::text AS series_type,
      min(sr.label) AS label,
      sr.chart_response_type AS response_type,
      false AS is_blood_pressure,
      NULL::text AS unit,
      count(*)::bigint AS observation_count,
      min(sr.created_at) AS first_observed_at,
      max(sr.created_at) AS last_observed_at
    FROM symptom_rows sr
    WHERE sr.chart_response_type <> 'text'
    GROUP BY sr.series_key, sr.chart_response_type
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


ALTER FUNCTION "public"."get_user_chart_manifest"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_chart_manifest"("p_user_id" "uuid") IS 'Returns chartable observation series for p_user_id (health markers and yes_no/severity symptoms). SECURITY INVOKER: RLS on health_markers and episode_symptoms applies; practitioners need an active practitioner_access grant.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(new.raw_user_meta_data ->> 'app_role', 'patient');
  IF v_role NOT IN ('patient', 'caretaker', 'practitioner') THEN
    v_role := 'patient';
  END IF;

  -- Require invite stamps for non-patient roles (blocks self-signup metadata spoofing).
  IF v_role = 'practitioner'
    AND nullif(trim(new.raw_user_meta_data ->> 'abstrack_practitioner_invite_id'), '') IS NULL THEN
    v_role := 'patient';
  ELSIF v_role = 'caretaker'
    AND nullif(trim(new.raw_user_meta_data ->> 'abstrack_caretaker_invite_id'), '') IS NULL THEN
    v_role := 'patient';
  END IF;

  IF v_role = 'practitioner' THEN
    PERFORM set_config('abstrack.provisioning_profile_from_auth', 'true', TRUE);
  END IF;

  INSERT INTO public.profiles (id, app_role)
    VALUES (new.id, v_role)
  ON CONFLICT (id)
    DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'After insert on auth.users: creates profiles from invite-stamped app_role metadata (Edge Functions) or patient for self-signup.';



CREATE OR REPLACE FUNCTION "public"."list_practitioner_auth_emails_for_patient_grants"("p_patient_user_id" "uuid", "p_practitioner_user_ids" "uuid"[]) RETURNS TABLE("practitioner_user_id" "uuid", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT DISTINCT ON (u.id)
    u.id AS practitioner_user_id,
    u.email::text AS email
  FROM unnest(p_practitioner_user_ids) AS requested (practitioner_user_id)
  INNER JOIN public.practitioner_access AS pa
    ON pa.practitioner_user_id = requested.practitioner_user_id
   AND pa.patient_user_id = p_patient_user_id
   AND pa.revoked_at IS NULL
  INNER JOIN auth.users AS u
    ON u.id = requested.practitioner_user_id
  ORDER BY u.id;
$$;


ALTER FUNCTION "public"."list_practitioner_auth_emails_for_patient_grants"("p_patient_user_id" "uuid", "p_practitioner_user_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_practitioner_auth_emails_for_patient_grants"("p_patient_user_id" "uuid", "p_practitioner_user_ids" "uuid"[]) IS 'Returns auth.users.email for practitioner ids that have an active practitioner_access grant to the given patient; patient-practitioner-access GET only. SECURITY DEFINER; service_role EXECUTE only.';



CREATE OR REPLACE FUNCTION "public"."mark_chart_snapshot_seen"("p_snapshot_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_row_count integer;
BEGIN
  IF (SELECT auth.uid ()) IS NULL THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  UPDATE
    public.chart_snapshots
  SET
    seen_by_patient_at = now ()
  WHERE
    id = p_snapshot_id
    AND patient_user_id = (SELECT auth.uid ())
    AND seen_by_patient_at IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  RETURN v_row_count > 0;
END;
$$;


ALTER FUNCTION "public"."mark_chart_snapshot_seen"("p_snapshot_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_chart_snapshot_seen"("p_snapshot_id" "uuid") IS 'Patient marks a shared chart snapshot as seen. SECURITY DEFINER; authenticated has no direct UPDATE on chart_snapshots. Only seen_by_patient_at may change (append-only trigger).';



CREATE OR REPLACE FUNCTION "public"."practitioner_observation_notes_immutable_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.patient_user_id IS DISTINCT FROM OLD.patient_user_id
      OR NEW.practitioner_user_id IS DISTINCT FROM OLD.practitioner_user_id
      OR NEW.episode_id IS DISTINCT FROM OLD.episode_id THEN
      RAISE EXCEPTION 'practitioner_observation_notes: patient_user_id, practitioner_user_id, and episode_id cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."practitioner_observation_notes_immutable_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."practitioner_observation_notes_immutable_scope"() IS 'Prevents reassigning a note to another patient, episode, or author after insert.';



CREATE OR REPLACE FUNCTION "public"."profiles_enforce_app_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.app_role = 'practitioner'
      AND NOT public.profiles_trusted_session_for_app_role ()
      AND current_setting('abstrack.provisioning_profile_from_auth', TRUE) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.app_role practitioner requires a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.app_role IS DISTINCT FROM NEW.app_role
      AND NOT public.profiles_trusted_session_for_app_role () THEN
      RAISE EXCEPTION 'profiles.app_role cannot be changed without a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."profiles_enforce_app_role"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."profiles_enforce_app_role"() IS 'Blocks practitioner self-signup and arbitrary app_role changes unless session is trusted (service_role / postgres). On INSERT, also allows practitioner when transaction-local abstrack.provisioning_profile_from_auth is true (set only by public.handle_new_user during auth.users provisioning).';



CREATE OR REPLACE FUNCTION "public"."profiles_trusted_session_for_app_role"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
    SELECT
      COALESCE((auth.jwt() ->> 'role') = 'service_role', FALSE)
      OR session_user = 'postgres';

$$;


ALTER FUNCTION "public"."profiles_trusted_session_for_app_role"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."profiles_trusted_session_for_app_role"() IS 'True for service_role JWT or direct postgres session (migrations / trusted role assignment).';



CREATE OR REPLACE FUNCTION "public"."reorder_preset_health_markers"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  n int;
  actual int;
  max_so int;
  updated int;
BEGIN
  -- Serialize reorder for this preset (pairs with parent FOR UPDATE when n > 0).
  PERFORM pg_advisory_xact_lock(
    hashtext('abstrack:reorder_preset_health_markers'),
    hashtext(p_preset_id::text)
  );

  n := coalesce(cardinality(p_ordered_ids), 0);

  IF n > 0 THEN
    -- Blocks concurrent child line inserts (FK) and other writers on this header until commit.
    PERFORM 1
    FROM public.health_marker_presets
    WHERE id = p_preset_id
    FOR UPDATE;
  END IF;

  SELECT COUNT(*)::int INTO actual
  FROM public.preset_health_markers
  WHERE preset_id = p_preset_id;

  IF n <> actual THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  IF n > 0 AND (
    SELECT COUNT(*) FROM unnest(p_ordered_ids) AS u(id)
  ) <> (
    SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_duplicate_id'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.preset_health_markers ph
      WHERE ph.id = t.id AND ph.preset_id = p_preset_id
    )
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_unknown_line'
      USING ERRCODE = 'P0001';
  END IF;

  IF n = 0 THEN
    RETURN;
  END IF;

  -- Lock all line rows for this preset (same pattern as reorder_preset_symptoms).
  PERFORM 1
  FROM public.preset_health_markers
  WHERE preset_id = p_preset_id
  FOR UPDATE;

  SELECT COALESCE(MAX(ph.sort_order), -1)
  INTO max_so
  FROM public.preset_health_markers ph
  WHERE ph.preset_id = p_preset_id;

  -- Phase 1: same dynamic band as reorder_preset_symptoms (strictly above max(sort_order)).
  UPDATE public.preset_health_markers ph
  SET sort_order = max_so + ord.pos
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ph.id = ord.id
    AND ph.preset_id = p_preset_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> n THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_update_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.preset_health_markers ph
  SET sort_order = ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ph.id = ord.id
    AND ph.preset_id = p_preset_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> n THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_update_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


ALTER FUNCTION "public"."reorder_preset_health_markers"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reorder_preset_health_markers"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) IS 'Reassigns sort_order for every preset_health_markers row for p_preset_id; p_ordered_ids lists each line id exactly once in display order.';



CREATE OR REPLACE FUNCTION "public"."reorder_preset_symptoms"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  n int;
  actual int;
  max_so int;
  updated int;
BEGIN
  -- Serialize reorder for this preset (pairs with parent FOR UPDATE when n > 0).
  PERFORM pg_advisory_xact_lock(
    hashtext('abstrack:reorder_preset_symptoms'),
    hashtext(p_preset_id::text)
  );

  n := coalesce(cardinality(p_ordered_ids), 0);

  IF n > 0 THEN
    -- Blocks concurrent child line inserts (FK) and other writers on this header until commit.
    PERFORM 1
    FROM public.symptom_presets
    WHERE id = p_preset_id
    FOR UPDATE;
  END IF;

  SELECT COUNT(*)::int INTO actual
  FROM public.preset_symptoms
  WHERE preset_id = p_preset_id;

  IF n <> actual THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  IF n > 0 AND (
    SELECT COUNT(*) FROM unnest(p_ordered_ids) AS u(id)
  ) <> (
    SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_duplicate_id'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.preset_symptoms ps
      WHERE ps.id = t.id AND ps.preset_id = p_preset_id
    )
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_unknown_line'
      USING ERRCODE = 'P0001';
  END IF;

  IF n = 0 THEN
    RETURN;
  END IF;

  -- Lock all line rows for this preset so concurrent UPDATE/DELETE on those rows cannot interleave.
  PERFORM 1
  FROM public.preset_symptoms
  WHERE preset_id = p_preset_id
  FOR UPDATE;

  SELECT COALESCE(MAX(ps.sort_order), -1)
  INTO max_so
  FROM public.preset_symptoms ps
  WHERE ps.preset_id = p_preset_id;

  -- Phase 1: temporary band strictly above current max(sort_order) to avoid UNIQUE conflicts mid-statement.
  UPDATE public.preset_symptoms ps
  SET sort_order = max_so + ord.pos
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ps.id = ord.id
    AND ps.preset_id = p_preset_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> n THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_update_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  -- Phase 2: assign final 0..n-1 order (one statement).
  UPDATE public.preset_symptoms ps
  SET sort_order = ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ps.id = ord.id
    AND ps.preset_id = p_preset_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> n THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_update_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


ALTER FUNCTION "public"."reorder_preset_symptoms"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reorder_preset_symptoms"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) IS 'Reassigns sort_order for every preset_symptoms row for p_preset_id; p_ordered_ids lists each line id exactly once in display order.';



CREATE OR REPLACE FUNCTION "public"."resolve_auth_user_id_by_normalized_email"("p_normalized" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IS NOT NULL
    AND u.email = p_normalized
  LIMIT 1;
$$;


ALTER FUNCTION "public"."resolve_auth_user_id_by_normalized_email"("p_normalized" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_auth_user_id_by_normalized_email"("p_normalized" "text") IS 'Maps normalized email to auth.users.id for patient-caretaker-access; callers MUST pass lower(trim(email)). Uses equality on auth.users.email so Postgres can use the btree index (GoTrue stores emails lowercase; trimming matches signup-normalized values). SECURITY DEFINER; service_role EXECUTE only.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_chart_snapshot"("p_patient_user_id" "uuid", "p_series_definition" "jsonb", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_chart_timezone" "text", "p_practitioner_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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


ALTER FUNCTION "public"."share_chart_snapshot"("p_patient_user_id" "uuid", "p_series_definition" "jsonb", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_chart_timezone" "text", "p_practitioner_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."share_chart_snapshot"("p_patient_user_id" "uuid", "p_series_definition" "jsonb", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_chart_timezone" "text", "p_practitioner_note" "text") IS 'Practitioner shares a chart snapshot with a linked patient. Args: bucket, chart_timezone (IANA, required), optional note. Replaces the six-argument function from 20260524130000.';



CREATE OR REPLACE FUNCTION "public"."stamp_caretaker_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  UPDATE public.caretaker_invites
  SET last_invite_sent_at = p_stamp
  WHERE id = p_invite_id
    AND consumed_at IS NULL
    AND (last_invite_sent_at IS NULL OR last_invite_sent_at <= p_throttle_cutoff)
  RETURNING id;
$$;


ALTER FUNCTION "public"."stamp_caretaker_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_caretaker_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) IS 'Atomically stamps caretaker_invites.last_invite_sent_at before inviteUserByEmail when last send is null or <= p_throttle_cutoff (inclusive minimum-interval boundary, matches Edge); service_role only.';


CREATE OR REPLACE FUNCTION "public"."stamp_episode_post_marker_boundary_from_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF
    NEW.post_marker_step_completed_at IS NOT NULL
    AND NEW.post_marker_step_completed_at IS DISTINCT FROM OLD.post_marker_step_completed_at
  THEN
    NEW.post_marker_step_completed_at := NEW.updated_at;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."stamp_episode_post_marker_boundary_from_updated_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_episode_post_marker_boundary_from_updated_at"() IS 'When post_marker_step_completed_at changes, stamps it from NEW.updated_at so pass boundary and row update share one server timestamp.';



CREATE OR REPLACE FUNCTION "public"."stamp_practitioner_access_last_invite_email_sent_at"("p_patient_user_id" "uuid", "p_practitioner_user_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  UPDATE public.practitioner_access
  SET last_invite_email_sent_at = p_stamp
  WHERE patient_user_id = p_patient_user_id
    AND practitioner_user_id = p_practitioner_user_id
    AND revoked_at IS NULL
    AND (last_invite_email_sent_at IS NULL OR last_invite_email_sent_at <= p_throttle_cutoff)
  RETURNING id;
$$;


ALTER FUNCTION "public"."stamp_practitioner_access_last_invite_email_sent_at"("p_patient_user_id" "uuid", "p_practitioner_user_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_practitioner_access_last_invite_email_sent_at"("p_patient_user_id" "uuid", "p_practitioner_user_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) IS 'Atomically stamps practitioner_access.last_invite_email_sent_at when outside resend window (active-grant invite email); service_role only.';



CREATE OR REPLACE FUNCTION "public"."stamp_practitioner_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  UPDATE public.practitioner_invites
  SET last_invite_sent_at = p_stamp
  WHERE id = p_invite_id
    AND consumed_at IS NULL
    AND (last_invite_sent_at IS NULL OR last_invite_sent_at <= p_throttle_cutoff)
  RETURNING id;
$$;


ALTER FUNCTION "public"."stamp_practitioner_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_practitioner_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) IS 'Atomically stamps practitioner_invites.last_invite_sent_at before inviteUserByEmail when last send is null or <= p_throttle_cutoff (inclusive minimum-interval boundary, matches Edge); service_role only.';



CREATE OR REPLACE FUNCTION "public"."user_has_practitioner_access"("p_patient_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_grant boolean;
  v_requires_mfa boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.practitioner_access pa
        INNER JOIN public.profiles pr ON pr.id = v_uid
      WHERE
        pa.patient_user_id = p_patient_user_id
        AND pa.practitioner_user_id = v_uid
        AND pa.revoked_at IS NULL
        AND pr.app_role = 'practitioner') INTO v_has_grant;

  IF NOT v_has_grant THEN
    RETURN FALSE;
  END IF;

  v_requires_mfa := COALESCE(
    (auth.jwt() -> 'user_metadata' ->> 'abstrack_practitioner_password_set') = 'true',
    FALSE
  );

  IF v_requires_mfa AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Practitioner MFA assurance (AAL2) is required to access patient data'
      USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."user_has_practitioner_access"("p_patient_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_has_practitioner_access"("p_patient_user_id" "uuid") IS 'True when the current user has profiles.app_role practitioner and an active practitioner_access grant. Raises 42501 when abstrack_practitioner_password_set is true in JWT user_metadata but aal is not aal2; magic-link–only accounts (flag false/absent) may read with AAL1.';



CREATE OR REPLACE FUNCTION "public"."user_is_caretaker_for_patient"("p_patient_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.caretaker_access ca
          INNER JOIN public.profiles pr ON pr.id = (SELECT auth.uid())
        WHERE
          ca.patient_user_id = p_patient_user_id
          AND ca.caretaker_user_id = (SELECT auth.uid())
          AND ca.revoked_at IS NULL
          AND pr.app_role = 'caretaker');

$$;


ALTER FUNCTION "public"."user_is_caretaker_for_patient"("p_patient_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_is_caretaker_for_patient"("p_patient_user_id" "uuid") IS 'True when the current user has profiles.app_role caretaker and an active caretaker_access link to this patient.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."access_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text" NOT NULL,
    "patient_user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "request_id" "text",
    "ip_hash" "text",
    CONSTRAINT "access_log_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['patient'::"text", 'caretaker'::"text", 'practitioner'::"text", 'system'::"text", 'service'::"text"])))
);


ALTER TABLE "public"."access_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."access_log" IS 'Append-only audit trail; no PHI or clinical free text. Privileges and triggers in issue #8.';



COMMENT ON COLUMN "public"."access_log"."action" IS 'e.g. read, write, auth_failure per PRD § Access logging.';



COMMENT ON COLUMN "public"."access_log"."resource_type" IS 'e.g. episode, storage_object; resource_id is opaque UUID.';



CREATE TABLE IF NOT EXISTS "public"."caretaker_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "caretaker_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "caretaker_access_check" CHECK (("patient_user_id" <> "caretaker_user_id"))
);


ALTER TABLE "public"."caretaker_access" OWNER TO "postgres";


COMMENT ON TABLE "public"."caretaker_access" IS 'Caretaker grant; partial unique index enforces one active caretaker per patient for MVP (PRD §7).';



CREATE TABLE IF NOT EXISTS "public"."caretaker_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "invitee_email_normalized" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "consumed_caretaker_user_id" "uuid",
    "last_invite_sent_at" timestamp with time zone,
    CONSTRAINT "caretaker_invites_expires_at_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "caretaker_invites_invitee_email_normalized_check" CHECK ((("invitee_email_normalized" = "lower"(TRIM(BOTH FROM "invitee_email_normalized"))) AND (("char_length"("invitee_email_normalized") >= 1) AND ("char_length"("invitee_email_normalized") <= 254))))
);


ALTER TABLE "public"."caretaker_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."caretaker_invites" IS 'Patient-sent caretaker invite before `caretaker_access`; one pending row per patient (partial unique).';



CREATE TABLE IF NOT EXISTS "public"."chart_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "practitioner_user_id" "uuid" NOT NULL,
    "series_definition" "jsonb" NOT NULL,
    "date_from" timestamp with time zone NOT NULL,
    "date_to" timestamp with time zone NOT NULL,
    "bucket" "text" NOT NULL,
    "practitioner_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seen_by_patient_at" timestamp with time zone,
    "chart_timezone" "text",
    CONSTRAINT "chart_snapshots_bucket_check" CHECK (("bucket" = ANY (ARRAY['day'::"text", 'week'::"text", 'month'::"text"]))),
    CONSTRAINT "chart_snapshots_date_range_chk" CHECK (("date_from" < "date_to")),
    CONSTRAINT "chart_snapshots_practitioner_note_len" CHECK ((("practitioner_note" IS NULL) OR ("char_length"("practitioner_note") <= 16000)))
);


ALTER TABLE "public"."chart_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."chart_snapshots" IS 'Practitioner-shared chart filter snapshot for patient Insights (PRD §9). Append-only; series_definition stores SelectedSeries[] JSON from the chart builder.';



COMMENT ON COLUMN "public"."chart_snapshots"."series_definition" IS 'SelectedSeries[] from @abstrack/ui chart builder (camelCase fields).';



COMMENT ON COLUMN "public"."chart_snapshots"."date_from" IS 'Inclusive chart range start (ISO timestamptz; matches get_chart_series p_from).';



COMMENT ON COLUMN "public"."chart_snapshots"."date_to" IS 'Exclusive chart range end (ISO timestamptz; matches get_chart_series p_to).';



COMMENT ON COLUMN "public"."chart_snapshots"."chart_timezone" IS 'IANA timezone used when the practitioner built the chart (matches get_chart_series p_timezone). Nullable for rows created before this column existed.';



CREATE TABLE IF NOT EXISTS "public"."episode_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "episode_symptom_id" "uuid",
    "storage_object_key" "text" NOT NULL,
    "thumbnail_storage_key" "text",
    "media_type" "text" NOT NULL,
    "duration_seconds" smallint,
    "upload_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "episode_media_duration_seconds_check" CHECK ((("duration_seconds" IS NULL) OR (("duration_seconds" >= 1) AND ("duration_seconds" <= 15)))),
    CONSTRAINT "episode_media_media_type_check" CHECK (("media_type" = ANY (ARRAY['photo'::"text", 'video'::"text"])))
);


ALTER TABLE "public"."episode_media" OWNER TO "postgres";


COMMENT ON TABLE "public"."episode_media" IS 'Metadata for private bucket objects; confidentiality via Storage RLS + TLS + platform encryption (PRD §10), not ciphertext columns here.';



COMMENT ON COLUMN "public"."episode_media"."storage_object_key" IS 'Path/key in episode-media bucket; MUST be "{user_id}/..." where user_id equals this row''s user_id (see migration header). RLS on storage.objects uses the same prefix. No ciphertext columns in Postgres per PRD §10.';



CREATE TABLE IF NOT EXISTS "public"."episode_symptoms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "preset_symptom_id" "uuid",
    "symptom_name" "text" NOT NULL,
    "response_type" "text" NOT NULL,
    "response_boolean" boolean,
    "response_severity" smallint,
    "response_text" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "episode_symptoms_response_matches_type" CHECK (((("response_type" = 'yes_no'::"text") AND ("response_severity" IS NULL) AND ("response_text" IS NULL)) OR (("response_type" = 'severity_scale'::"text") AND ("response_boolean" IS NULL) AND ("response_text" IS NULL)) OR (("response_type" = 'free_text'::"text") AND ("response_boolean" IS NULL) AND ("response_severity" IS NULL)) OR (("response_type" = ANY (ARRAY['photo'::"text", 'video'::"text"])) AND ("response_boolean" IS NULL) AND ("response_severity" IS NULL) AND ("response_text" IS NULL)))),
    CONSTRAINT "episode_symptoms_response_severity_check" CHECK ((("response_severity" IS NULL) OR (("response_severity" >= 1) AND ("response_severity" <= 5)))),
    CONSTRAINT "episode_symptoms_response_type_check" CHECK (("response_type" = ANY (ARRAY['yes_no'::"text", 'severity_scale'::"text", 'free_text'::"text", 'photo'::"text", 'video'::"text"]))),
    CONSTRAINT "episode_symptoms_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."episode_symptoms" OWNER TO "postgres";


COMMENT ON TABLE "public"."episode_symptoms" IS 'Symptom answers as rows; episode_id NULL allows ad-hoc symptom logs without a full episode (PRD §5).';



COMMENT ON COLUMN "public"."episode_symptoms"."episode_id" IS 'Null for standalone / wellness symptom entries; set when part of an episode flow.';



CREATE TABLE IF NOT EXISTS "public"."episode_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "symptom_preset_id" "uuid" NOT NULL,
    "health_marker_preset_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."episode_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."episode_templates" IS 'Named template: required symptom + health-marker preset pair for episode starts (both FKs NOT NULL). Deleting either preset CASCADE-deletes the template. RLS: patient and linked caretaker read/write; practitioner read-only with grant (PRD); user_id immutability via phi_user_id_immutable.';



COMMENT ON COLUMN "public"."episode_templates"."symptom_preset_id" IS 'Required FK to symptom_presets.id; ON DELETE CASCADE removes this template if the symptom preset is deleted. Same-owner vs user_id is enforced by trigger episode_template_preset_owners.';



COMMENT ON COLUMN "public"."episode_templates"."health_marker_preset_id" IS 'Required FK to health_marker_presets.id; ON DELETE CASCADE removes this template if the health-marker preset is deleted. Same-owner vs user_id is enforced by trigger episode_template_preset_owners.';



CREATE TABLE IF NOT EXISTS "public"."episodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "symptom_preset_id" "uuid",
    "episode_type" "text" DEFAULT 'Other'::"text" NOT NULL,
    "episode_label" "text",
    "note" "text",
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "health_marker_preset_id" "uuid",
    "additional_notes" "text",
    "post_marker_step_completed_at" timestamp with time zone,
    CONSTRAINT "episodes_ended_after_started" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "started_at"))),
    CONSTRAINT "episodes_episode_type_check" CHECK (("episode_type" = ANY (ARRAY['ABS'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."episodes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."episodes"."symptom_preset_id" IS 'Optional FK to symptom_presets.id; ON DELETE SET NULL clears only this column. Same-owner vs user_id is enforced by trigger episode_preset_owners (composite FK SET NULL would null user_id).';



COMMENT ON COLUMN "public"."episodes"."episode_type" IS 'Filtering/metadata: ABS vs Other per PRD §4.';



COMMENT ON COLUMN "public"."episodes"."note" IS 'Optional general note on the episode (PRD §4 step 6). Distinct from additional_notes.';



COMMENT ON COLUMN "public"."episodes"."health_marker_preset_id" IS 'Optional FK to health_marker_presets.id; ON DELETE SET NULL clears only this column. Same-owner vs user_id is enforced by trigger episode_preset_owners.';



COMMENT ON COLUMN "public"."episodes"."additional_notes" IS 'Optional free text for symptoms or health markers not in the user''s presets, after preset prompts (PRD §4 step 4).';



COMMENT ON COLUMN "public"."episodes"."post_marker_step_completed_at" IS 'Set when the user completes the post–health-marker episode details step; used to resume after preset markers without repeating that step.';



CREATE TABLE IF NOT EXISTS "public"."food_diary_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "meal_tag" "text" NOT NULL,
    "food_note" "text" NOT NULL,
    "logged_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "food_diary_entries_meal_tag_check" CHECK (("meal_tag" = ANY (ARRAY['Breakfast'::"text", 'Lunch'::"text", 'Dinner'::"text", 'Snack'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."food_diary_entries" OWNER TO "postgres";


COMMENT ON COLUMN "public"."food_diary_entries"."episode_id" IS 'Optional link; ON DELETE SET NULL only clears episode_id. Same-owner vs user_id is enforced by trigger food_diary_episode_owner (composite FK would SET NULL both columns and break NOT NULL on user_id).';



COMMENT ON COLUMN "public"."food_diary_entries"."meal_tag" IS 'Filtering metadata: Breakfast / Lunch / Dinner / Snack / Other per PRD §6.';



COMMENT ON COLUMN "public"."food_diary_entries"."food_note" IS 'Free-text meal description; plaintext under RLS per PRD §6.';



CREATE TABLE IF NOT EXISTS "public"."health_marker_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."health_marker_presets" OWNER TO "postgres";


COMMENT ON TABLE "public"."health_marker_presets" IS 'One named health-marker preset per row (PRD §3); preset_health_markers.preset_id FKs here.';



CREATE TABLE IF NOT EXISTS "public"."health_markers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "marker_kind" "text" NOT NULL,
    "custom_name" "text",
    "custom_unit" "text",
    "value_numeric" numeric,
    "systolic_numeric" numeric,
    "diastolic_numeric" numeric,
    "recorded_at" timestamp with time zone NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_name_key" "text" GENERATED ALWAYS AS (COALESCE("custom_name", ''::"text")) STORED,
    "custom_unit_key" "text" GENERATED ALWAYS AS (COALESCE("custom_unit", ''::"text")) STORED,
    "preset_health_marker_id" "uuid",
    CONSTRAINT "health_markers_episode_requires_preset_line" CHECK ((("episode_id" IS NULL) OR ("preset_health_marker_id" IS NOT NULL))),
    CONSTRAINT "health_markers_marker_kind_check" CHECK (("marker_kind" = ANY (ARRAY['bac'::"text", 'blood_glucose'::"text", 'blood_pressure'::"text", 'heart_rate'::"text", 'weight'::"text", 'custom'::"text", 'wellness_mood'::"text"])))
);


ALTER TABLE "public"."health_markers" OWNER TO "postgres";


COMMENT ON TABLE "public"."health_markers" IS 'Manual marker entries; episode_id NULL for wellness / non-episode capture (PRD §3, §5).';



COMMENT ON COLUMN "public"."health_markers"."marker_kind" IS 'Includes wellness_mood for “how are you feeling” style logs per PRD §5.';



COMMENT ON COLUMN "public"."health_markers"."custom_name_key" IS 'Generated from custom_name; do not insert or update.';



COMMENT ON COLUMN "public"."health_markers"."custom_unit_key" IS 'Generated from custom_unit; do not insert or update.';



COMMENT ON COLUMN "public"."health_markers"."preset_health_marker_id" IS 'Preset line (`preset_health_markers.id`) for episode-bound rows; paired with episode_id for upsert. NULL for wellness / non-episode rows. Deleting a referenced preset line is blocked while episode markers still reference it.';



CREATE TABLE IF NOT EXISTS "public"."practitioner_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "practitioner_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "last_invite_email_sent_at" timestamp with time zone,
    CONSTRAINT "practitioner_access_check" CHECK (("patient_user_id" <> "practitioner_user_id"))
);


ALTER TABLE "public"."practitioner_access" OWNER TO "postgres";


COMMENT ON TABLE "public"."practitioner_access" IS 'Grant rows for practitioner read access; enforced by RLS in later migrations.';



COMMENT ON COLUMN "public"."practitioner_access"."last_invite_email_sent_at" IS 'Last auth.admin.inviteUserByEmail for active-grant resend reminders; throttled via stamp_practitioner_access_last_invite_email_sent_at (patient-practitioner-access Edge).';



CREATE TABLE IF NOT EXISTS "public"."practitioner_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "invitee_email_normalized" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "consumed_practitioner_user_id" "uuid",
    "last_invite_sent_at" timestamp with time zone,
    CONSTRAINT "practitioner_invites_expires_at_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "practitioner_invites_invitee_email_normalized_check" CHECK ((("invitee_email_normalized" = "lower"(TRIM(BOTH FROM "invitee_email_normalized"))) AND (("char_length"("invitee_email_normalized") >= 1) AND ("char_length"("invitee_email_normalized") <= 254))))
);


ALTER TABLE "public"."practitioner_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."practitioner_invites" IS 'Patient-sent practitioner invite before a practitioner_access grant row exists for this patient; one pending row per patient (partial unique).';



CREATE TABLE IF NOT EXISTS "public"."practitioner_observation_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_user_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "practitioner_user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "practitioner_observation_notes_body_check" CHECK (("char_length"("body") <= 16000))
);


ALTER TABLE "public"."practitioner_observation_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."practitioner_observation_notes" IS 'PRD §8 practitioner-authored observation notes. Scoped by patient_user_id; optional episode_id (NULL = patient-level note). Writes only for practitioners with grant + MFA; patients/caretakers SELECT only.';



COMMENT ON COLUMN "public"."practitioner_observation_notes"."episode_id" IS 'When set, note is tied to a specific episode of patient_user_id; NULL means a patient-record-level note (PRD §8).';



COMMENT ON COLUMN "public"."practitioner_observation_notes"."body" IS 'Plaintext clinical free text; RLS + TLS + platform encryption at rest (same PHI posture as other note fields).';



CREATE TABLE IF NOT EXISTS "public"."preset_health_markers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "preset_id" "uuid" NOT NULL,
    "sort_order" integer NOT NULL,
    "marker_kind" "text" NOT NULL,
    "custom_name" "text",
    "custom_unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preset_health_markers_marker_kind_check" CHECK (("marker_kind" = ANY (ARRAY['bac'::"text", 'blood_glucose'::"text", 'blood_pressure'::"text", 'heart_rate'::"text", 'weight'::"text", 'custom'::"text"]))),
    CONSTRAINT "preset_health_markers_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."preset_health_markers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."preset_health_markers"."sort_order" IS 'Explicit per-row order within a preset; UNIQUE (preset_id, sort_order).';



CREATE TABLE IF NOT EXISTS "public"."preset_symptoms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "preset_id" "uuid" NOT NULL,
    "sort_order" integer NOT NULL,
    "symptom_name" "text" NOT NULL,
    "response_type" "text" NOT NULL,
    "prompt_instruction" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preset_symptoms_response_type_check" CHECK (("response_type" = ANY (ARRAY['yes_no'::"text", 'severity_scale'::"text", 'free_text'::"text", 'photo'::"text", 'video'::"text"]))),
    CONSTRAINT "preset_symptoms_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."preset_symptoms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."preset_symptoms"."sort_order" IS 'Explicit per-row order within a preset; UNIQUE (preset_id, sort_order).';



COMMENT ON COLUMN "public"."preset_symptoms"."response_type" IS 'Symptom capture UI: yes/no, 1–5 scale, text, or media per PRD §2.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "app_role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_app_role_check" CHECK (("app_role" = ANY (ARRAY['patient'::"text", 'caretaker'::"text", 'practitioner'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'App profile keyed to auth.users; display_name may be identifying. Role used for routing; RLS in later migrations.';



CREATE TABLE IF NOT EXISTS "public"."symptom_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."symptom_presets" OWNER TO "postgres";


COMMENT ON TABLE "public"."symptom_presets" IS 'One named symptom preset per row (PRD §2); preset_symptoms.preset_id FKs here.';



ALTER TABLE ONLY "public"."access_log"
    ADD CONSTRAINT "access_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caretaker_access"
    ADD CONSTRAINT "caretaker_access_patient_user_id_caretaker_user_id_key" UNIQUE ("patient_user_id", "caretaker_user_id");



ALTER TABLE ONLY "public"."caretaker_access"
    ADD CONSTRAINT "caretaker_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caretaker_invites"
    ADD CONSTRAINT "caretaker_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chart_snapshots"
    ADD CONSTRAINT "chart_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_media"
    ADD CONSTRAINT "episode_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_symptoms"
    ADD CONSTRAINT "episode_symptoms_episode_id_id_key" UNIQUE ("episode_id", "id");



ALTER TABLE ONLY "public"."episode_symptoms"
    ADD CONSTRAINT "episode_symptoms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_templates"
    ADD CONSTRAINT "episode_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_user_id_id_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."food_diary_entries"
    ADD CONSTRAINT "food_diary_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_marker_presets"
    ADD CONSTRAINT "health_marker_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_markers"
    ADD CONSTRAINT "health_markers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practitioner_access"
    ADD CONSTRAINT "practitioner_access_patient_user_id_practitioner_user_id_key" UNIQUE ("patient_user_id", "practitioner_user_id");



ALTER TABLE ONLY "public"."practitioner_access"
    ADD CONSTRAINT "practitioner_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practitioner_invites"
    ADD CONSTRAINT "practitioner_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practitioner_observation_notes"
    ADD CONSTRAINT "practitioner_observation_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preset_health_markers"
    ADD CONSTRAINT "preset_health_markers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preset_health_markers"
    ADD CONSTRAINT "preset_health_markers_preset_id_sort_order_key" UNIQUE ("preset_id", "sort_order");



ALTER TABLE ONLY "public"."preset_symptoms"
    ADD CONSTRAINT "preset_symptoms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preset_symptoms"
    ADD CONSTRAINT "preset_symptoms_preset_id_sort_order_key" UNIQUE ("preset_id", "sort_order");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."symptom_presets"
    ADD CONSTRAINT "symptom_presets_pkey" PRIMARY KEY ("id");



CREATE INDEX "access_log_actor_time_idx" ON "public"."access_log" USING "btree" ("actor_user_id", "occurred_at" DESC);



CREATE INDEX "access_log_patient_time_idx" ON "public"."access_log" USING "btree" ("patient_user_id", "occurred_at" DESC);



CREATE INDEX "access_log_resource_idx" ON "public"."access_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "caretaker_access_caretaker_idx" ON "public"."caretaker_access" USING "btree" ("caretaker_user_id");



CREATE UNIQUE INDEX "caretaker_access_one_active_per_patient_idx" ON "public"."caretaker_access" USING "btree" ("patient_user_id") WHERE ("revoked_at" IS NULL);



CREATE UNIQUE INDEX "caretaker_invites_one_pending_per_patient_idx" ON "public"."caretaker_invites" USING "btree" ("patient_user_id") WHERE ("consumed_at" IS NULL);



CREATE INDEX "caretaker_invites_pending_by_email_idx" ON "public"."caretaker_invites" USING "btree" ("invitee_email_normalized") WHERE ("consumed_at" IS NULL);



CREATE INDEX "chart_snapshots_patient_unseen_idx" ON "public"."chart_snapshots" USING "btree" ("patient_user_id", "created_at" DESC) WHERE ("seen_by_patient_at" IS NULL);



CREATE INDEX "chart_snapshots_practitioner_idx" ON "public"."chart_snapshots" USING "btree" ("practitioner_user_id", "patient_user_id", "created_at" DESC);



CREATE INDEX "episode_media_episode_idx" ON "public"."episode_media" USING "btree" ("episode_id");



CREATE INDEX "episode_media_symptom_step_idx" ON "public"."episode_media" USING "btree" ("episode_symptom_id");



CREATE INDEX "episode_media_user_idx" ON "public"."episode_media" USING "btree" ("user_id");



CREATE INDEX "episode_symptoms_episode_idx" ON "public"."episode_symptoms" USING "btree" ("episode_id");



CREATE INDEX "episode_symptoms_episode_preset_line_idx" ON "public"."episode_symptoms" USING "btree" ("episode_id", "preset_symptom_id") WHERE (("episode_id" IS NOT NULL) AND ("preset_symptom_id" IS NOT NULL));



COMMENT ON INDEX "public"."episode_symptoms_episode_preset_line_idx" IS 'Non-unique lookup for episode + preset line; multiple rows per pair are allowed (ordered by created_at, id).';



CREATE INDEX "episode_symptoms_episode_sort_idx" ON "public"."episode_symptoms" USING "btree" ("episode_id", "sort_order");



CREATE INDEX "episode_symptoms_user_created_at_idx" ON "public"."episode_symptoms" USING "btree" ("user_id", "created_at" DESC);



COMMENT ON INDEX "public"."episode_symptoms_user_created_at_idx" IS 'Supports per-user symptom history range queries (e.g. get_chart_series, get_user_chart_manifest).';



CREATE INDEX "episode_symptoms_user_idx" ON "public"."episode_symptoms" USING "btree" ("user_id");



CREATE INDEX "episode_templates_user_idx" ON "public"."episode_templates" USING "btree" ("user_id");



CREATE UNIQUE INDEX "episodes_one_active_per_user_idx" ON "public"."episodes" USING "btree" ("user_id") WHERE ("ended_at" IS NULL);



COMMENT ON INDEX "public"."episodes_one_active_per_user_idx" IS 'Ensures at most one open episode per user; aligns with app-layer start guards.';



CREATE INDEX "episodes_user_started_idx" ON "public"."episodes" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "episodes_user_type_idx" ON "public"."episodes" USING "btree" ("user_id", "episode_type");



CREATE INDEX "food_diary_episode_idx" ON "public"."food_diary_entries" USING "btree" ("episode_id");



CREATE INDEX "food_diary_user_logged_idx" ON "public"."food_diary_entries" USING "btree" ("user_id", "logged_at" DESC);



CREATE INDEX "health_marker_presets_user_idx" ON "public"."health_marker_presets" USING "btree" ("user_id");



CREATE INDEX "health_markers_episode_idx" ON "public"."health_markers" USING "btree" ("episode_id");



CREATE INDEX "health_markers_episode_preset_line_idx" ON "public"."health_markers" USING "btree" ("episode_id", "preset_health_marker_id") WHERE (("episode_id" IS NOT NULL) AND ("preset_health_marker_id" IS NOT NULL));



COMMENT ON INDEX "public"."health_markers_episode_preset_line_idx" IS 'Non-unique lookup for episode + preset line; multiple rows per pair are allowed (ordered by recorded_at, created_at, id).';



CREATE INDEX "health_markers_user_recorded_idx" ON "public"."health_markers" USING "btree" ("user_id", "recorded_at" DESC);



CREATE INDEX "practitioner_access_active_idx" ON "public"."practitioner_access" USING "btree" ("practitioner_user_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "practitioner_access_patient_idx" ON "public"."practitioner_access" USING "btree" ("patient_user_id");



CREATE INDEX "practitioner_access_practitioner_idx" ON "public"."practitioner_access" USING "btree" ("practitioner_user_id");



CREATE UNIQUE INDEX "practitioner_invites_one_pending_per_patient_idx" ON "public"."practitioner_invites" USING "btree" ("patient_user_id") WHERE ("consumed_at" IS NULL);



CREATE INDEX "practitioner_invites_pending_by_email_idx" ON "public"."practitioner_invites" USING "btree" ("invitee_email_normalized") WHERE ("consumed_at" IS NULL);



CREATE INDEX "practitioner_observation_notes_patient_created_idx" ON "public"."practitioner_observation_notes" USING "btree" ("patient_user_id", "created_at" DESC);



CREATE INDEX "practitioner_observation_notes_patient_episode_idx" ON "public"."practitioner_observation_notes" USING "btree" ("patient_user_id", "episode_id");



CREATE INDEX "practitioner_observation_notes_practitioner_idx" ON "public"."practitioner_observation_notes" USING "btree" ("practitioner_user_id", "patient_user_id");



CREATE INDEX "preset_health_markers_preset_idx" ON "public"."preset_health_markers" USING "btree" ("preset_id");



CREATE INDEX "preset_health_markers_preset_sort_idx" ON "public"."preset_health_markers" USING "btree" ("preset_id", "sort_order");



CREATE INDEX "preset_symptoms_preset_idx" ON "public"."preset_symptoms" USING "btree" ("preset_id");



CREATE INDEX "preset_symptoms_preset_sort_idx" ON "public"."preset_symptoms" USING "btree" ("preset_id", "sort_order");



CREATE INDEX "profiles_app_role_idx" ON "public"."profiles" USING "btree" ("app_role");



CREATE INDEX "symptom_presets_user_idx" ON "public"."symptom_presets" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "access_log_append_only" BEFORE DELETE OR UPDATE ON "public"."access_log" FOR EACH ROW EXECUTE FUNCTION "public"."access_log_prevent_update_or_delete"();



CREATE OR REPLACE TRIGGER "caretaker_access_profile_roles" BEFORE INSERT OR UPDATE ON "public"."caretaker_access" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_caretaker_access_profile_roles"();



CREATE OR REPLACE TRIGGER "chart_snapshots_append_only" BEFORE DELETE OR UPDATE ON "public"."chart_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."chart_snapshots_append_only_guard"();



CREATE OR REPLACE TRIGGER "chart_snapshots_chart_timezone" BEFORE INSERT OR UPDATE ON "public"."chart_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."chart_snapshots_chart_timezone_guard"();



CREATE OR REPLACE TRIGGER "episode_preset_owners" BEFORE INSERT OR UPDATE OF "symptom_preset_id", "health_marker_preset_id", "user_id" ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_episode_preset_owners"();



CREATE OR REPLACE TRIGGER "episode_symptoms_block_after_end" BEFORE INSERT OR UPDATE ON "public"."episode_symptoms" FOR EACH ROW EXECUTE FUNCTION "public"."assert_episode_child_not_after_episode_end"();



CREATE OR REPLACE TRIGGER "episode_template_preset_owners" BEFORE INSERT OR UPDATE OF "symptom_preset_id", "health_marker_preset_id", "user_id" ON "public"."episode_templates" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_episode_template_preset_owners"();



CREATE OR REPLACE TRIGGER "food_diary_block_after_end" BEFORE INSERT OR UPDATE ON "public"."food_diary_entries" FOR EACH ROW EXECUTE FUNCTION "public"."assert_episode_child_not_after_episode_end"();



CREATE OR REPLACE TRIGGER "food_diary_episode_owner" BEFORE INSERT OR UPDATE OF "episode_id", "user_id" ON "public"."food_diary_entries" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_food_diary_episode_owner"();



CREATE OR REPLACE TRIGGER "health_markers_block_after_end" BEFORE INSERT OR UPDATE ON "public"."health_markers" FOR EACH ROW EXECUTE FUNCTION "public"."assert_episode_child_not_after_episode_end"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."episode_media" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."episode_symptoms" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."episode_templates" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."food_diary_entries" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."health_marker_presets" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."health_markers" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "phi_user_id_immutable" BEFORE UPDATE ON "public"."symptom_presets" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phi_row_user_id_immutable"();



CREATE OR REPLACE TRIGGER "practitioner_access_profile_roles" BEFORE INSERT OR UPDATE ON "public"."practitioner_access" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_practitioner_access_profile_roles"();



CREATE OR REPLACE TRIGGER "practitioner_observation_notes_immutable_scope" BEFORE UPDATE ON "public"."practitioner_observation_notes" FOR EACH ROW EXECUTE FUNCTION "public"."practitioner_observation_notes_immutable_scope"();



CREATE OR REPLACE TRIGGER "profiles_enforce_app_role" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_enforce_app_role"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."episode_media" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."episode_symptoms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."episode_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."food_diary_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."health_marker_presets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."health_markers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."practitioner_observation_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."preset_health_markers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."preset_symptoms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."symptom_presets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "zz_episode_post_marker_boundary_stamp" BEFORE UPDATE OF "post_marker_step_completed_at" ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_episode_post_marker_boundary_from_updated_at"();



ALTER TABLE ONLY "public"."access_log"
    ADD CONSTRAINT "access_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."access_log"
    ADD CONSTRAINT "access_log_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caretaker_access"
    ADD CONSTRAINT "caretaker_access_caretaker_user_id_fkey" FOREIGN KEY ("caretaker_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caretaker_access"
    ADD CONSTRAINT "caretaker_access_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caretaker_invites"
    ADD CONSTRAINT "caretaker_invites_consumed_caretaker_user_id_fkey" FOREIGN KEY ("consumed_caretaker_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caretaker_invites"
    ADD CONSTRAINT "caretaker_invites_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chart_snapshots"
    ADD CONSTRAINT "chart_snapshots_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chart_snapshots"
    ADD CONSTRAINT "chart_snapshots_practitioner_user_id_fkey" FOREIGN KEY ("practitioner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_media"
    ADD CONSTRAINT "episode_media_episode_fk" FOREIGN KEY ("user_id", "episode_id") REFERENCES "public"."episodes"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_media"
    ADD CONSTRAINT "episode_media_symptom_step_fk" FOREIGN KEY ("episode_id", "episode_symptom_id") REFERENCES "public"."episode_symptoms"("episode_id", "id") ON DELETE CASCADE;



COMMENT ON CONSTRAINT "episode_media_symptom_step_fk" ON "public"."episode_media" IS 'Links media to a symptom step in the same episode; ON DELETE CASCADE removes metadata if the symptom row is deleted (composite SET NULL would null episode_id, which is NOT NULL).';



ALTER TABLE ONLY "public"."episode_media"
    ADD CONSTRAINT "episode_media_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_symptoms"
    ADD CONSTRAINT "episode_symptoms_episode_fk" FOREIGN KEY ("user_id", "episode_id") REFERENCES "public"."episodes"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_symptoms"
    ADD CONSTRAINT "episode_symptoms_preset_symptom_id_fkey" FOREIGN KEY ("preset_symptom_id") REFERENCES "public"."preset_symptoms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."episode_symptoms"
    ADD CONSTRAINT "episode_symptoms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_templates"
    ADD CONSTRAINT "episode_templates_health_marker_preset_id_fk" FOREIGN KEY ("health_marker_preset_id") REFERENCES "public"."health_marker_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_templates"
    ADD CONSTRAINT "episode_templates_symptom_preset_id_fk" FOREIGN KEY ("symptom_preset_id") REFERENCES "public"."symptom_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_templates"
    ADD CONSTRAINT "episode_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_health_marker_preset_id_fk" FOREIGN KEY ("health_marker_preset_id") REFERENCES "public"."health_marker_presets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_symptom_preset_id_fk" FOREIGN KEY ("symptom_preset_id") REFERENCES "public"."symptom_presets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_diary_entries"
    ADD CONSTRAINT "food_diary_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_diary_entries"
    ADD CONSTRAINT "food_diary_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."health_marker_presets"
    ADD CONSTRAINT "health_marker_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_markers"
    ADD CONSTRAINT "health_markers_episode_fk" FOREIGN KEY ("user_id", "episode_id") REFERENCES "public"."episodes"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_markers"
    ADD CONSTRAINT "health_markers_preset_health_marker_id_fkey" FOREIGN KEY ("preset_health_marker_id") REFERENCES "public"."preset_health_markers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."health_markers"
    ADD CONSTRAINT "health_markers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_access"
    ADD CONSTRAINT "practitioner_access_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_access"
    ADD CONSTRAINT "practitioner_access_practitioner_user_id_fkey" FOREIGN KEY ("practitioner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_invites"
    ADD CONSTRAINT "practitioner_invites_consumed_practitioner_user_id_fkey" FOREIGN KEY ("consumed_practitioner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."practitioner_invites"
    ADD CONSTRAINT "practitioner_invites_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_observation_notes"
    ADD CONSTRAINT "practitioner_observation_notes_episode_owner_fk" FOREIGN KEY ("patient_user_id", "episode_id") REFERENCES "public"."episodes"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_observation_notes"
    ADD CONSTRAINT "practitioner_observation_notes_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practitioner_observation_notes"
    ADD CONSTRAINT "practitioner_observation_notes_practitioner_user_id_fkey" FOREIGN KEY ("practitioner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preset_health_markers"
    ADD CONSTRAINT "preset_health_markers_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "public"."health_marker_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preset_symptoms"
    ADD CONSTRAINT "preset_symptoms_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "public"."symptom_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."symptom_presets"
    ADD CONSTRAINT "symptom_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."access_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "access_log_deny_delete" ON "public"."access_log" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "access_log_deny_update" ON "public"."access_log" FOR UPDATE TO "authenticated" USING (false);



CREATE POLICY "access_log_select" ON "public"."access_log" FOR SELECT TO "authenticated" USING ((("patient_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("actor_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "access_log_service_role_insert" ON "public"."access_log" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "access_log_service_role_select" ON "public"."access_log" FOR SELECT TO "service_role" USING (true);



ALTER TABLE "public"."caretaker_access" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "caretaker_access_caretaker_select" ON "public"."caretaker_access" FOR SELECT TO "authenticated" USING (("caretaker_user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "caretaker_access_patient_all" ON "public"."caretaker_access" TO "authenticated" USING (("patient_user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("patient_user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "caretaker_access_service_role_insert" ON "public"."caretaker_access" FOR INSERT TO "service_role" WITH CHECK (true);



COMMENT ON POLICY "caretaker_access_service_role_insert" ON "public"."caretaker_access" IS 'Trusted INSERT for patient-caretaker-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "caretaker_access_service_role_select" ON "public"."caretaker_access" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "caretaker_access_service_role_select" ON "public"."caretaker_access" IS 'Trusted SELECT for patient-caretaker-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "caretaker_access_service_role_update" ON "public"."caretaker_access" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



COMMENT ON POLICY "caretaker_access_service_role_update" ON "public"."caretaker_access" IS 'Trusted UPDATE (revoke, reactivate, finalize rollback) for patient-caretaker-access when service_role is subject to RLS.';



ALTER TABLE "public"."caretaker_invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "caretaker_invites_service_role_delete" ON "public"."caretaker_invites" FOR DELETE TO "service_role" USING (("consumed_at" IS NULL));



COMMENT ON POLICY "caretaker_invites_service_role_delete" ON "public"."caretaker_invites" IS 'Trusted DELETE for pending rows only (USING consumed_at IS NULL): clear pending / rollback; consumed rows are retained.';



CREATE POLICY "caretaker_invites_service_role_insert" ON "public"."caretaker_invites" FOR INSERT TO "service_role" WITH CHECK (true);



COMMENT ON POLICY "caretaker_invites_service_role_insert" ON "public"."caretaker_invites" IS 'Trusted INSERT for patient-caretaker-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "caretaker_invites_service_role_select" ON "public"."caretaker_invites" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "caretaker_invites_service_role_select" ON "public"."caretaker_invites" IS 'Trusted SELECT for patient-caretaker-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "caretaker_invites_service_role_update" ON "public"."caretaker_invites" FOR UPDATE TO "service_role" USING (("consumed_at" IS NULL)) WITH CHECK (true);



COMMENT ON POLICY "caretaker_invites_service_role_update" ON "public"."caretaker_invites" IS 'Trusted UPDATE for pending rows only (USING consumed_at IS NULL): resend stamp, extend expiry, consume; consumed rows are immutable via UPDATE.';



ALTER TABLE "public"."chart_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chart_snapshots_insert" ON "public"."chart_snapshots" FOR INSERT TO "authenticated" WITH CHECK ((("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id")));



CREATE POLICY "chart_snapshots_select" ON "public"."chart_snapshots" FOR SELECT TO "authenticated" USING ((("patient_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id"))));



ALTER TABLE "public"."episode_media" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "episode_media_delete" ON "public"."episode_media" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_media_insert" ON "public"."episode_media" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_media_select" ON "public"."episode_media" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "episode_media_update" ON "public"."episode_media" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."episode_symptoms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "episode_symptoms_delete" ON "public"."episode_symptoms" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_symptoms_insert" ON "public"."episode_symptoms" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_symptoms_select" ON "public"."episode_symptoms" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "episode_symptoms_update" ON "public"."episode_symptoms" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."episode_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "episode_templates_delete" ON "public"."episode_templates" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_templates_insert" ON "public"."episode_templates" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episode_templates_select" ON "public"."episode_templates" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "episode_templates_update" ON "public"."episode_templates" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."episodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "episodes_delete" ON "public"."episodes" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episodes_insert" ON "public"."episodes" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "episodes_select" ON "public"."episodes" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "episodes_update" ON "public"."episodes" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."food_diary_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "food_diary_entries_delete" ON "public"."food_diary_entries" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "food_diary_entries_insert" ON "public"."food_diary_entries" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "food_diary_entries_select" ON "public"."food_diary_entries" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "food_diary_entries_update" ON "public"."food_diary_entries" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."health_marker_presets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "health_marker_presets_delete" ON "public"."health_marker_presets" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "health_marker_presets_insert" ON "public"."health_marker_presets" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "health_marker_presets_select" ON "public"."health_marker_presets" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "health_marker_presets_update" ON "public"."health_marker_presets" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."health_markers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "health_markers_delete" ON "public"."health_markers" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "health_markers_insert" ON "public"."health_markers" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "health_markers_select" ON "public"."health_markers" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "health_markers_update" ON "public"."health_markers" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



ALTER TABLE "public"."practitioner_access" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "practitioner_access_patient_all" ON "public"."practitioner_access" TO "authenticated" USING (("patient_user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("patient_user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "practitioner_access_practitioner_select" ON "public"."practitioner_access" FOR SELECT TO "authenticated" USING (("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "practitioner_access_service_role_insert" ON "public"."practitioner_access" FOR INSERT TO "service_role" WITH CHECK (true);



COMMENT ON POLICY "practitioner_access_service_role_insert" ON "public"."practitioner_access" IS 'Trusted INSERT for patient-practitioner-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "practitioner_access_service_role_select" ON "public"."practitioner_access" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "practitioner_access_service_role_select" ON "public"."practitioner_access" IS 'Trusted SELECT for automation (e.g. MFA audit Edge Function) when service_role is subject to RLS.';



CREATE POLICY "practitioner_access_service_role_update" ON "public"."practitioner_access" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



COMMENT ON POLICY "practitioner_access_service_role_update" ON "public"."practitioner_access" IS 'Trusted UPDATE (revoke via revoked_at, reactivate grant) for patient-practitioner-access when service_role is subject to RLS.';



ALTER TABLE "public"."practitioner_invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "practitioner_invites_service_role_delete" ON "public"."practitioner_invites" FOR DELETE TO "service_role" USING (("consumed_at" IS NULL));



COMMENT ON POLICY "practitioner_invites_service_role_delete" ON "public"."practitioner_invites" IS 'Trusted DELETE for pending rows only (USING consumed_at IS NULL): clear pending / rollback; consumed rows are retained.';



CREATE POLICY "practitioner_invites_service_role_insert" ON "public"."practitioner_invites" FOR INSERT TO "service_role" WITH CHECK (true);



COMMENT ON POLICY "practitioner_invites_service_role_insert" ON "public"."practitioner_invites" IS 'Trusted INSERT for patient-practitioner-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "practitioner_invites_service_role_select" ON "public"."practitioner_invites" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "practitioner_invites_service_role_select" ON "public"."practitioner_invites" IS 'Trusted SELECT for patient-practitioner-access Edge Function when service_role is subject to RLS.';



CREATE POLICY "practitioner_invites_service_role_update" ON "public"."practitioner_invites" FOR UPDATE TO "service_role" USING (("consumed_at" IS NULL)) WITH CHECK (true);



COMMENT ON POLICY "practitioner_invites_service_role_update" ON "public"."practitioner_invites" IS 'Trusted UPDATE for pending rows only (USING consumed_at IS NULL): resend stamp, extend expiry, consume; consumed rows are immutable via UPDATE.';



ALTER TABLE "public"."practitioner_observation_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "practitioner_observation_notes_delete" ON "public"."practitioner_observation_notes" FOR DELETE TO "authenticated" USING ((("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id")));



COMMENT ON POLICY "practitioner_observation_notes_delete" ON "public"."practitioner_observation_notes" IS 'Practitioner may DELETE own notes when grant + MFA rules pass via user_has_practitioner_access (password-gated AAL2).';



CREATE POLICY "practitioner_observation_notes_insert" ON "public"."practitioner_observation_notes" FOR INSERT TO "authenticated" WITH CHECK ((("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id")));



CREATE POLICY "practitioner_observation_notes_select" ON "public"."practitioner_observation_notes" FOR SELECT TO "authenticated" USING ((("patient_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("patient_user_id") OR "public"."user_has_practitioner_access"("patient_user_id")));



CREATE POLICY "practitioner_observation_notes_update" ON "public"."practitioner_observation_notes" FOR UPDATE TO "authenticated" USING ((("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id"))) WITH CHECK ((("practitioner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."user_has_practitioner_access"("patient_user_id")));



ALTER TABLE "public"."preset_health_markers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preset_health_markers_delete" ON "public"."preset_health_markers" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."health_marker_presets" "hp"
  WHERE (("hp"."id" = "preset_health_markers"."preset_id") AND (("hp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("hp"."user_id"))))));



CREATE POLICY "preset_health_markers_insert" ON "public"."preset_health_markers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."health_marker_presets" "hp"
  WHERE (("hp"."id" = "preset_health_markers"."preset_id") AND (("hp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("hp"."user_id"))))));



CREATE POLICY "preset_health_markers_select" ON "public"."preset_health_markers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."health_marker_presets" "hp"
  WHERE (("hp"."id" = "preset_health_markers"."preset_id") AND (("hp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("hp"."user_id") OR "public"."user_has_practitioner_access"("hp"."user_id"))))));



CREATE POLICY "preset_health_markers_update" ON "public"."preset_health_markers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."health_marker_presets" "hp"
  WHERE (("hp"."id" = "preset_health_markers"."preset_id") AND (("hp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("hp"."user_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."health_marker_presets" "hp"
  WHERE (("hp"."id" = "preset_health_markers"."preset_id") AND (("hp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("hp"."user_id"))))));



ALTER TABLE "public"."preset_symptoms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preset_symptoms_delete" ON "public"."preset_symptoms" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."symptom_presets" "sp"
  WHERE (("sp"."id" = "preset_symptoms"."preset_id") AND (("sp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("sp"."user_id"))))));



CREATE POLICY "preset_symptoms_insert" ON "public"."preset_symptoms" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."symptom_presets" "sp"
  WHERE (("sp"."id" = "preset_symptoms"."preset_id") AND (("sp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("sp"."user_id"))))));



CREATE POLICY "preset_symptoms_select" ON "public"."preset_symptoms" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."symptom_presets" "sp"
  WHERE (("sp"."id" = "preset_symptoms"."preset_id") AND (("sp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("sp"."user_id") OR "public"."user_has_practitioner_access"("sp"."user_id"))))));



CREATE POLICY "preset_symptoms_update" ON "public"."preset_symptoms" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."symptom_presets" "sp"
  WHERE (("sp"."id" = "preset_symptoms"."preset_id") AND (("sp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("sp"."user_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."symptom_presets" "sp"
  WHERE (("sp"."id" = "preset_symptoms"."preset_id") AND (("sp"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("sp"."user_id"))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) AND ("app_role" = ANY (ARRAY['patient'::"text", 'caretaker'::"text"]))));



CREATE POLICY "profiles_practitioner_granted_patient_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("app_role" = 'patient'::"text") AND "public"."user_has_practitioner_access"("id")));



COMMENT ON POLICY "profiles_practitioner_granted_patient_select" ON "public"."profiles" IS 'Practitioner may SELECT patient profiles for active practitioner_access grants; MFA rules match user_has_practitioner_access (password-gated AAL2).';



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "profiles_service_role_all" ON "public"."profiles" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."symptom_presets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "symptom_presets_delete" ON "public"."symptom_presets" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "symptom_presets_insert" ON "public"."symptom_presets" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



CREATE POLICY "symptom_presets_select" ON "public"."symptom_presets" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id") OR "public"."user_has_practitioner_access"("user_id")));



CREATE POLICY "symptom_presets_update" ON "public"."symptom_presets" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."user_is_caretaker_for_patient"("user_id")));



-- PowerSync role + publication (idempotent).
-- Schema dumps emit bare CREATE PUBLICATION, which fails when PowerSync (or a prior
-- bootstrap) already created `powersync` on the target. Role creation is also missing
-- from typical schema dumps — restore both here before GRANTs below.
-- Password is NOT set here; set it manually for the PowerSync source connection.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      pg_roles
    WHERE
      rolname = 'powersync_role') THEN
    CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN;
  END IF;
  ALTER ROLE powersync_role WITH LOGIN REPLICATION BYPASSRLS;
END
$$;

COMMENT ON ROLE powersync_role IS 'PowerSync logical replication; BYPASSRLS — sync scope enforced in PowerSync Sync Rules, not RLS on this role. Set password manually after migration.';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO powersync_role', current_database());
END
$$;

DO $$
DECLARE
  tbl text;
  extra_tbl text;
  needs_recreate boolean := FALSE;
  required_tables text[] := ARRAY[
    'profiles',
    'access_log',
    'practitioner_access',
    'caretaker_access',
    'symptom_presets',
    'preset_symptoms',
    'health_marker_presets',
    'preset_health_markers',
    'episode_templates',
    'episodes',
    'episode_symptoms',
    'health_markers',
    'food_diary_entries',
    'episode_media',
    'practitioner_observation_notes'
  ];
BEGIN
  -- PowerSync bootstrap often creates `powersync` as FOR ALL TABLES. That shape cannot
  -- be narrowed with ALTER — drop and recreate with the explicit allowlist.
  IF EXISTS (
    SELECT
      1
    FROM
      pg_publication p
    WHERE
      p.pubname = 'powersync'
      AND p.puballtables IS TRUE
  ) THEN
    needs_recreate := TRUE;
  ELSIF to_regclass('pg_catalog.pg_publication_namespace') IS NOT NULL
    AND EXISTS (
      SELECT
        1
      FROM
        pg_publication_namespace pn
        INNER JOIN pg_publication p ON p.oid = pn.pnpubid
      WHERE
        p.pubname = 'powersync'
    ) THEN
    needs_recreate := TRUE;
  ELSIF EXISTS (
    SELECT
      1
    FROM
      pg_publication_tables pt
    WHERE
      pt.pubname = 'powersync'
      AND pt.schemaname <> 'public'
  ) THEN
    needs_recreate := TRUE;
  END IF;

  IF needs_recreate THEN
    DROP PUBLICATION powersync;
  END IF;

  IF NOT EXISTS (
    SELECT
      1
    FROM
      pg_publication p
    WHERE
      p.pubname = 'powersync') THEN
    EXECUTE $powersync_pub$
    CREATE PUBLICATION powersync FOR TABLE public.profiles,
    public.access_log,
    public.practitioner_access,
    public.caretaker_access,
    public.symptom_presets,
    public.preset_symptoms,
    public.health_marker_presets,
    public.preset_health_markers,
    public.episode_templates,
    public.episodes,
    public.episode_symptoms,
    public.health_markers,
    public.food_diary_entries,
    public.episode_media,
    public.practitioner_observation_notes
    $powersync_pub$;
  ELSE
    FOR extra_tbl IN
    SELECT
      pt.tablename::text AS tablename
    FROM
      pg_publication_tables pt
    WHERE
      pt.pubname = 'powersync'
      AND pt.schemaname = 'public'
      AND NOT (pt.tablename::text = ANY (required_tables))
      LOOP
        EXECUTE format('ALTER PUBLICATION powersync DROP TABLE public.%I', extra_tbl);
      END LOOP;
    FOREACH tbl IN ARRAY required_tables
    LOOP
      IF NOT EXISTS (
        SELECT
          1
        FROM
          pg_publication_tables pt
        WHERE
          pt.pubname = 'powersync'
          AND pt.schemaname = 'public'
          AND pt.tablename::text = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION powersync ADD TABLE public.%I', tbl);
      END IF;
    END LOOP;
  END IF;
END
$$;

COMMENT ON PUBLICATION powersync IS 'PowerSync: replicate ABStrack PHI tables listed in sync-rules.yaml only (not FOR ALL TABLES).';

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "powersync_role";































































































































































REVOKE ALL ON FUNCTION "public"."delete_chart_snapshots_maintenance"("p_snapshot_id" "uuid", "p_patient_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_chart_snapshots_maintenance"("p_snapshot_id" "uuid", "p_patient_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_caretaker_access_profile_roles"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enforce_phi_row_user_id_immutable"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enforce_practitioner_access_profile_roles"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."episode_media_storage_can_select"("p_object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."episode_media_storage_can_select"("p_object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."episode_media_storage_can_write"("p_object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."episode_media_storage_can_write"("p_object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."episode_media_storage_path_user_id"("p_object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."episode_media_storage_path_user_id"("p_object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_chart_series"("p_user_id" "uuid", "p_series" "jsonb", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_bucket" "text", "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_chart_series"("p_user_id" "uuid", "p_series" "jsonb", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_bucket" "text", "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_episode_start_hour_distribution"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_episode_start_hour_distribution"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_episode_summary"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_episode_summary"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_episode_week_counts"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_episode_week_counts"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_symptom_frequency"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_symptom_frequency"("p_user_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_user_chart_manifest"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_chart_manifest"("p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."list_practitioner_auth_emails_for_patient_grants"("p_patient_user_id" "uuid", "p_practitioner_user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_practitioner_auth_emails_for_patient_grants"("p_patient_user_id" "uuid", "p_practitioner_user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_chart_snapshot_seen"("p_snapshot_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_chart_snapshot_seen"("p_snapshot_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."practitioner_observation_notes_immutable_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."profiles_enforce_app_role"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."profiles_trusted_session_for_app_role"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."reorder_preset_health_markers"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_preset_health_markers"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reorder_preset_symptoms"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_preset_symptoms"("p_preset_id" "uuid", "p_ordered_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."resolve_auth_user_id_by_normalized_email"("p_normalized" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_auth_user_id_by_normalized_email"("p_normalized" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."share_chart_snapshot"("p_patient_user_id" "uuid", "p_series_definition" "jsonb", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_chart_timezone" "text", "p_practitioner_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_chart_snapshot"("p_patient_user_id" "uuid", "p_series_definition" "jsonb", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_bucket" "text", "p_chart_timezone" "text", "p_practitioner_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."stamp_caretaker_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_caretaker_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_practitioner_access_last_invite_email_sent_at"("p_patient_user_id" "uuid", "p_practitioner_user_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_practitioner_access_last_invite_email_sent_at"("p_patient_user_id" "uuid", "p_practitioner_user_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_practitioner_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_practitioner_invite_pre_send"("p_invite_id" "uuid", "p_stamp" timestamp with time zone, "p_throttle_cutoff" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_practitioner_access"("p_patient_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_practitioner_access"("p_patient_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."user_is_caretaker_for_patient"("p_patient_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_is_caretaker_for_patient"("p_patient_user_id" "uuid") TO "authenticated";


















GRANT SELECT ON TABLE "public"."access_log" TO "powersync_role";
GRANT SELECT ON TABLE "public"."access_log" TO "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."access_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."caretaker_access" TO "anon";
GRANT ALL ON TABLE "public"."caretaker_access" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."caretaker_access" TO "service_role";
GRANT SELECT ON TABLE "public"."caretaker_access" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."caretaker_invites" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."caretaker_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."caretaker_invites" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."chart_snapshots" TO "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."chart_snapshots" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_media" TO "anon";
GRANT ALL ON TABLE "public"."episode_media" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_media" TO "service_role";
GRANT SELECT ON TABLE "public"."episode_media" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_symptoms" TO "anon";
GRANT ALL ON TABLE "public"."episode_symptoms" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_symptoms" TO "service_role";
GRANT SELECT ON TABLE "public"."episode_symptoms" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_templates" TO "anon";
GRANT ALL ON TABLE "public"."episode_templates" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episode_templates" TO "service_role";
GRANT SELECT ON TABLE "public"."episode_templates" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episodes" TO "anon";
GRANT ALL ON TABLE "public"."episodes" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."episodes" TO "service_role";
GRANT SELECT ON TABLE "public"."episodes" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."food_diary_entries" TO "anon";
GRANT ALL ON TABLE "public"."food_diary_entries" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."food_diary_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."food_diary_entries" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_marker_presets" TO "anon";
GRANT ALL ON TABLE "public"."health_marker_presets" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_marker_presets" TO "service_role";
GRANT SELECT ON TABLE "public"."health_marker_presets" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_markers" TO "anon";
GRANT ALL ON TABLE "public"."health_markers" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."health_markers" TO "service_role";
GRANT SELECT ON TABLE "public"."health_markers" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."practitioner_access" TO "anon";
GRANT ALL ON TABLE "public"."practitioner_access" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."practitioner_access" TO "service_role";
GRANT SELECT ON TABLE "public"."practitioner_access" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."practitioner_invites" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."practitioner_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."practitioner_invites" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."practitioner_observation_notes" TO "anon";
GRANT ALL ON TABLE "public"."practitioner_observation_notes" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."practitioner_observation_notes" TO "service_role";
GRANT SELECT ON TABLE "public"."practitioner_observation_notes" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_health_markers" TO "anon";
GRANT ALL ON TABLE "public"."preset_health_markers" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_health_markers" TO "service_role";
GRANT SELECT ON TABLE "public"."preset_health_markers" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_symptoms" TO "anon";
GRANT ALL ON TABLE "public"."preset_symptoms" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_symptoms" TO "service_role";
GRANT SELECT ON TABLE "public"."preset_symptoms" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "powersync_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."symptom_presets" TO "anon";
GRANT ALL ON TABLE "public"."symptom_presets" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."symptom_presets" TO "service_role";
GRANT SELECT ON TABLE "public"."symptom_presets" TO "powersync_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE POLICY "episode_media_storage_delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'episode-media'::"text") AND "public"."episode_media_storage_can_write"("name")));



CREATE POLICY "episode_media_storage_insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'episode-media'::"text") AND "public"."episode_media_storage_can_write"("name")));



CREATE POLICY "episode_media_storage_select" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'episode-media'::"text") AND "public"."episode_media_storage_can_select"("name")));



CREATE POLICY "episode_media_storage_update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'episode-media'::"text") AND "public"."episode_media_storage_can_write"("name"))) WITH CHECK ((("bucket_id" = 'episode-media'::"text") AND "public"."episode_media_storage_can_write"("name")));



