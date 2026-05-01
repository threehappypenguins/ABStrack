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
--
-- Publication DDL is idempotent: if `powersync` already exists (manual bootstrap / repair),
-- we enforce the intended allowlist (reject FOR ALL TABLES / TABLES IN SCHEMA / non-public tables),
-- DROP TABLE only for extra public tables, then ADD TABLE for any missing allowlist entries.

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
  -- Ensure required attributes even when the role pre-existed (manual bootstrap / drift).
  ALTER ROLE powersync_role WITH LOGIN REPLICATION BYPASSRLS;
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

DO $$
DECLARE
  tbl text;
  extra_tbl text;
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
    'episode_media'
  ];
BEGIN
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
    public.episode_media
    $powersync_pub$;
  ELSE
    IF EXISTS (
      SELECT
        1
      FROM
        pg_publication p
      WHERE
        p.pubname = 'powersync'
        AND p.puballtables IS TRUE) THEN
      RAISE EXCEPTION USING MESSAGE = 'Publication powersync uses FOR ALL TABLES; drop and recreate with an explicit FOR TABLE list (see migration 20260430120000_powersync_replication_role_and_publication.sql).';
    END IF;
    IF to_regclass('pg_catalog.pg_publication_namespace') IS NOT NULL THEN
      IF EXISTS (
        SELECT
          1
        FROM
          pg_publication_namespace pn
          INNER JOIN pg_publication p ON p.oid = pn.pnpubid
        WHERE
          p.pubname = 'powersync') THEN
        RAISE EXCEPTION USING MESSAGE = 'Publication powersync uses TABLES IN SCHEMA; drop schema mappings or recreate with explicit FOR TABLE list only (see migration 20260430120000_powersync_replication_role_and_publication.sql).';
      END IF;
    END IF;
    IF EXISTS (
      SELECT
        1
      FROM
        pg_publication_tables pt
      WHERE
        pt.pubname = 'powersync'
        AND pt.schemaname <> 'public') THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'Publication powersync must only reference schema public; remove non-public members or recreate (found: %s).',
        (
          SELECT
            string_agg(quote_ident(pt.schemaname) || '.' || quote_ident(pt.tablename::text), ', ' ORDER BY pt.schemaname, pt.tablename)
          FROM
            pg_publication_tables pt
          WHERE
            pt.pubname = 'powersync'
            AND pt.schemaname <> 'public'));
    END IF;
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
