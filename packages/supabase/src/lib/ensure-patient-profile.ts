import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** True when PostgREST reports a duplicate primary key (concurrent profile insert). */
export function isPostgresUniqueViolation(
  err: { code?: string } | null | undefined,
): boolean {
  return err?.code === '23505';
}

/**
 * Ensures a `public.profiles` row exists for a patient self-signup when absent.
 *
 * @param client - Supabase client with the user's session.
 * @param userId - `auth.users.id`.
 * @returns Success or an error message.
 */
export async function ensurePatientProfileRow(
  client: AbstrackSupabaseClient,
  userId: string,
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
    app_role: 'patient',
  });

  if (!insErr || isPostgresUniqueViolation(insErr)) {
    return { ok: true };
  }
  return { ok: false, message: insErr.message };
}
