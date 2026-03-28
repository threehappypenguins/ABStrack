-- Episode media Storage (PRD §10, ROADMAP Week 2): private bucket + RLS on storage.objects.
--
-- Confidentiality: private bucket + RLS + TLS + platform encryption at rest — not app-layer DEK
-- wrapping of objects. Optional @abstrack/crypto does not encrypt blobs in this bucket for MVP.
--
-- Path convention: object keys MUST start with {patient_user_id}/... where patient_user_id is the
-- owning auth user UUID (first path segment). Aligns with public.episode_media.storage_object_key.
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

COMMENT ON COLUMN public.episode_media.storage_object_key IS 'Path/key within the episode-media bucket; first segment MUST be the owning patient auth user id ({user_id}/...). RLS on storage.objects uses the same convention. No ciphertext columns in Postgres per PRD §10.';

-- ---------------------------------------------------------------------------
-- First path segment → patient UUID (invalid or missing segment → NULL, policies fail closed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.episode_media_storage_path_patient_id (p_object_name text)
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

COMMENT ON FUNCTION public.episode_media_storage_path_patient_id (text) IS 'Patient (owner) user id from episode-media object path: first segment must be a UUID. Keys MUST be {patient_user_id}/... per PRD §10 / episode_media.storage_object_key.';

REVOKE ALL ON FUNCTION public.episode_media_storage_path_patient_id (text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.episode_media_storage_path_patient_id (text) TO authenticated;

-- ---------------------------------------------------------------------------
-- storage.objects — episode-media only; no anon policies (anonymous has no access)
-- ---------------------------------------------------------------------------
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY episode_media_storage_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_path_patient_id (name) IS NOT NULL
    AND (
      public.episode_media_storage_path_patient_id (name) = (SELECT auth.uid())
      OR public.user_is_caretaker_for_patient (public.episode_media_storage_path_patient_id (name))
      OR public.user_has_practitioner_access (public.episode_media_storage_path_patient_id (name))));

CREATE POLICY episode_media_storage_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_path_patient_id (name) IS NOT NULL
    AND (
      public.episode_media_storage_path_patient_id (name) = (SELECT auth.uid())
      OR public.user_is_caretaker_for_patient (public.episode_media_storage_path_patient_id (name))));

CREATE POLICY episode_media_storage_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_path_patient_id (name) IS NOT NULL
    AND (
      public.episode_media_storage_path_patient_id (name) = (SELECT auth.uid())
      OR public.user_is_caretaker_for_patient (public.episode_media_storage_path_patient_id (name))))
  WITH CHECK (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_path_patient_id (name) IS NOT NULL
    AND (
      public.episode_media_storage_path_patient_id (name) = (SELECT auth.uid())
      OR public.user_is_caretaker_for_patient (public.episode_media_storage_path_patient_id (name))));

CREATE POLICY episode_media_storage_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'episode-media'
    AND public.episode_media_storage_path_patient_id (name) IS NOT NULL
    AND (
      public.episode_media_storage_path_patient_id (name) = (SELECT auth.uid())
      OR public.user_is_caretaker_for_patient (public.episode_media_storage_path_patient_id (name))));
