import type { Database } from './database.types.js';

type HealthMarkersTable = Database['public']['Tables']['health_markers'];

/**
 * PostgREST insert payload for `public.health_markers`.
 *
 * Excludes `custom_name_key` / `custom_unit_key` (GENERATED ALWAYS — Postgres rejects explicit
 * writes). `supabase gen types` may still list those keys on `Insert`; this type omits them.
 */
export type HealthMarkersInsert = Omit<
  HealthMarkersTable['Insert'],
  'custom_name_key' | 'custom_unit_key'
>;

/**
 * PostgREST update payload for `public.health_markers`.
 *
 * Same exclusions as {@link HealthMarkersInsert}.
 */
export type HealthMarkersUpdate = Omit<
  HealthMarkersTable['Update'],
  'custom_name_key' | 'custom_unit_key'
>;
