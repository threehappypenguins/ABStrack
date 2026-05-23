import type { AppRole } from '@abstrack/types';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Roles a user may self-provision via signup or invite completion (not practitioner). */
export type SelfServiceProfileRole = Extract<AppRole, 'patient' | 'caretaker'>;

/** True when PostgREST reports a duplicate primary key (concurrent profile insert). */
export function isPostgresUniqueViolation(
  err: { code?: string } | null | undefined,
): boolean {
  return err?.code === '23505';
}

/**
 * Ensures a `public.profiles` row exists with the given self-service role when absent.
 *
 * Does not change `app_role` when a row already exists — callers that require a specific
 * role must verify `profiles.app_role` after this returns `{ ok: true }`.
 *
 * @param client - Supabase client with the user's session.
 * @param userId - `auth.users.id`.
 * @param appRole - `patient` (self-signup) or `caretaker` (invite completion).
 * @returns Success or an error message.
 */
export async function ensureProfileRow(
  client: AbstrackSupabaseClient,
  userId: string,
  appRole: SelfServiceProfileRole,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = userId.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Missing user id.' };
  }

  const { data: existing, error: readErr } = await client
    .from('profiles')
    .select('id')
    .eq('id', trimmed)
    .maybeSingle();

  if (readErr) {
    return { ok: false, message: readErr.message };
  }
  if (existing) {
    return { ok: true };
  }

  const { error: insErr } = await client.from('profiles').insert({
    id: trimmed,
    app_role: appRole,
  });

  if (!insErr || isPostgresUniqueViolation(insErr)) {
    return { ok: true };
  }
  return { ok: false, message: insErr.message };
}

/**
 * Ensures a patient `public.profiles` row exists for self-signup when absent.
 *
 * @param client - Supabase client with the user's session.
 * @param userId - `auth.users.id`.
 * @returns Success or an error message.
 */
export async function ensurePatientProfileRow(
  client: AbstrackSupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return ensureProfileRow(client, userId, 'patient');
}
