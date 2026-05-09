/**
 * Canonical list of `public` tables replicated to PowerSync clients.
 *
 * Must stay aligned with:
 * - `packages/powersync/sync-rules.yaml` (`FROM` / `JOIN` references)
 * - `supabase/migrations/20260430120000_powersync_replication_role_and_publication.sql`
 *   (`required_tables` + publication / grants), plus later migrations that
 *   `ALTER PUBLICATION powersync ADD TABLE` (see `replicated-artifacts-alignment.spec.ts`)
 * - `apps/mobile/src/lib/powersync/abstrack-app-schema.ts` — replicated tables below **plus**
 *   {@link MOBILE_LOCAL_ONLY_POWER_SYNC_SCHEMA_TABLE_NAMES} (`localOnly` client tables not in Postgres
 *   sync streams).
 *
 * Vitest asserts YAML + migration agree with {@link REPLICATED_PUBLIC_TABLE_NAMES}
 * (`replicated-artifacts-alignment.spec.ts`).
 */
export const REPLICATED_PUBLIC_TABLE_NAMES = [
  'access_log',
  'caretaker_access',
  'episode_media',
  'episode_symptoms',
  'episode_templates',
  'episodes',
  'food_diary_entries',
  'health_marker_presets',
  'health_markers',
  'preset_health_markers',
  'preset_symptoms',
  'practitioner_access',
  'practitioner_observation_notes',
  'profiles',
  'symptom_presets',
] as const;

/**
 * Mobile PowerSync `Schema` entries that are **local-only** (not replicated from Supabase).
 * Keep in sync with `localOnly: true` tables in `abstrack-app-schema.ts`.
 */
export const MOBILE_LOCAL_ONLY_POWER_SYNC_SCHEMA_TABLE_NAMES = [
  'pending_episode_media_storage_cleanup',
  'pending_episode_media_upload',
] as const;

export type ReplicatedPublicTableName =
  (typeof REPLICATED_PUBLIC_TABLE_NAMES)[number];
