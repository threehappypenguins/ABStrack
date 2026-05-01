/**
 * Canonical list of `public` tables replicated to PowerSync clients.
 *
 * Must stay aligned with:
 * - `packages/powersync/sync-rules.yaml` (`FROM` / `JOIN` references)
 * - `supabase/migrations/20260430120000_powersync_replication_role_and_publication.sql`
 *   (`required_tables` + publication / grants)
 * - `apps/mobile/src/lib/powersync/abstrack-app-schema.ts` (`Schema` table keys)
 *
 * Vitest asserts YAML + migration agree with this list (`replicated-artifacts-alignment.spec.ts`).
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
  'profiles',
  'symptom_presets',
] as const;

export type ReplicatedPublicTableName =
  (typeof REPLICATED_PUBLIC_TABLE_NAMES)[number];
