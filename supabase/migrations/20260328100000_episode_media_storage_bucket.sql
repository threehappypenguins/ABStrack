-- Episode media Storage (PRD §10, ROADMAP Week 2): private bucket + RLS on storage.objects.
--
-- Confidentiality: private bucket + RLS + TLS + platform encryption at rest — not app-layer DEK
-- wrapping of objects. Optional @abstrack/crypto does not encrypt blobs in this bucket for MVP.
--
-- Object key prefix (one term only): "{user_id}/..." — user_id is always public.episode_media.user_id
-- (auth uid of the patient who owns the row). Do not use other placeholders (e.g. {patient_user_id}) in
-- docs or client code; alternate names invite keys that do not match this column or RLS.
--
-- Signed URLs: time-limited URLs (e.g. ~60s) for playback/download are created by the client/app in
-- later weeks; this migration is only the bucket and policy shell — no client decrypt step for objects.

-- ---------------------------------------------------------------------------
-- Bucket (private; not anonymous)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
  VALUES ('episode-media', 'episode-media', FALSE)
ON CONFLICT (id)
  DO UPDATE SET
    public = FALSE,
    name = EXCLUDED.name;

COMMENT ON COLUMN public.episode_media.storage_object_key IS 'Path/key in episode-media bucket; MUST be "{user_id}/..." where user_id equals this row''s user_id (see migration header). RLS on storage.objects uses the same prefix. No ciphertext columns in Postgres per PRD §10.';

-- ---------------------------------------------------------------------------
-- First path segment → episode_media.user_id value (invalid or missing segment → NULL, fail closed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.episode_media_storage_path_user_id (p_object_name text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, storage, public
  AS $$
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
  $$;

COMMENT ON FUNCTION public.episode_media_storage_path_user_id (text) IS 'Parses public.episode_media.user_id from object path: first segment must be a UUID. Keys MUST be "{user_id}/..." with that user_id per PRD §10.';

REVOKE ALL ON FUNCTION public.episode_media_storage_path_user_id (text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.episode_media_storage_path_user_id (text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Single evaluation of path → user_id per policy check (avoid repeated foldername/regex)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.episode_media_storage_can_select (p_object_name text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
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

COMMENT ON FUNCTION public.episode_media_storage_can_select (text) IS 'True if current user may read/list episode-media object: owner, active caretaker, or authorized practitioner. Computes episode_media.user_id from path once.';

CREATE OR REPLACE FUNCTION public.episode_media_storage_can_write (p_object_name text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, public
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

COMMENT ON FUNCTION public.episode_media_storage_can_write (text) IS 'True if current user may insert/update/delete episode-media object: owner or active caretaker only. Computes episode_media.user_id from path once.';

REVOKE ALL ON FUNCTION public.episode_media_storage_can_select (text)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.episode_media_storage_can_write (text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.episode_media_storage_can_select (text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.episode_media_storage_can_write (text) TO authenticated;

-- ---------------------------------------------------------------------------
-- storage.objects — episode-media only; no anon policies (anonymous has no access)
-- ---------------------------------------------------------------------------
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY episode_media_storage_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_can_select (name));

CREATE POLICY episode_media_storage_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_can_write (name));

CREATE POLICY episode_media_storage_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_can_write (name))
  WITH CHECK (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_can_write (name));

CREATE POLICY episode_media_storage_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_can_write (name));
