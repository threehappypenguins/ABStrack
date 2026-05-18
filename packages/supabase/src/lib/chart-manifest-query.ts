import type { Uuid } from '@abstrack/types';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Chart manifest `response_type` values returned by `get_user_chart_manifest`. */
export type ChartManifestResponseType =
  | 'numeric'
  | 'boolean'
  | 'severity'
  | 'text';

/** One chartable series row from `get_user_chart_manifest`. */
export interface UserChartManifestSeries {
  series_id: string;
  series_type: 'health_marker' | 'symptom';
  label: string;
  response_type: ChartManifestResponseType;
  is_blood_pressure: boolean;
  unit: string | null;
  observation_count: number;
  first_observed_at: string;
  last_observed_at: string;
}

/**
 * Loads chartable series metadata for a patient via `get_user_chart_manifest`.
 * Uses `SECURITY INVOKER` so existing RLS on `health_markers` and `episode_symptoms` applies.
 *
 * @param client - Supabase client with the caller JWT.
 * @param userId - Subject user id (`p_user_id`).
 * @returns Manifest rows from Postgres, unchanged.
 */
export async function getUserChartManifest(
  client: AbstrackSupabaseClient,
  userId: Uuid,
): Promise<UserChartManifestSeries[]> {
  const { data, error } = await client.rpc('get_user_chart_manifest', {
    p_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as UserChartManifestSeries[];
}
