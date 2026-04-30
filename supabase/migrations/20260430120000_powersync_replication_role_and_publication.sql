-- PowerSync replication role + publication for logical decoding from Supabase Postgres.
--
-- Password is NOT set here (avoid committing secrets). After this migration is applied:
--   ALTER ROLE powersync_role PASSWORD 'your-generated-secret';
-- Use that secret only in the PowerSync source-database connection UI / vault.
--
-- Sync scope matches tables referenced in packages/powersync/sync-rules.yaml.
-- When adding a replicated table: GRANT SELECT ... TO powersync_role;
--   ALTER PUBLICATION powersync ADD TABLE public.<table>;
-- See docs: https://docs.powersync.com/configuration/source-db/setup#postgres

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
END
$$;

COMMENT ON ROLE powersync_role IS 'PowerSync logical replication; BYPASSRLS — sync scope enforced in PowerSync Sync Rules, not RLS on this role. Set password manually after migration.';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO powersync_role', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO powersync_role;

GRANT SELECT ON TABLE public.profiles,
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
public.episode_media TO powersync_role;

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
public.episode_media;

COMMENT ON PUBLICATION powersync IS 'PowerSync: replicate ABStrack PHI tables listed in sync-rules.yaml only (not FOR ALL TABLES).';
