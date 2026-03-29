import type { AbstrackSupabaseClient } from './auth.js';

/** Single profile row for the given auth user id, if RLS allows. */
export async function fetchProfileByUserId(
  client: AbstrackSupabaseClient,
  userId: string,
) {
  return client.from('profiles').select('*').eq('id', userId).maybeSingle();
}

/**
 * Minimal read to validate connectivity and session + RLS (empty error when allowed,
 * no rows when RLS blocks or user has no profile yet).
 */
export async function healthCheckProfilesLimit1(client: AbstrackSupabaseClient) {
  return client.from('profiles').select('id').limit(1);
}
