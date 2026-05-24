import type { AppRole } from '@abstrack/types';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Roles a user may self-provision via signup or invite completion (not practitioner). */
export type SelfServiceProfileRole = Extract<AppRole, 'patient' | 'caretaker'>;

/** Result when {@link ensureProfileRow} cannot complete. */
export type EnsureProfileRowFailure = {
  ok: false;
  /** Safe copy for UI; do not surface {@link cause} to end users. */
  message: string;
  /** Raw PostgREST/Postgres detail for logging or diagnostics. */
  cause?: string;
};

/** @returns Outcome of ensuring a self-service profile row exists. */
export type EnsureProfileRowResult = { ok: true } | EnsureProfileRowFailure;

const PROFILE_READ_ERROR_MESSAGE =
  'Unable to load your profile. Try again in a moment.';

function profileInsertErrorMessage(appRole: SelfServiceProfileRole): string {
  return appRole === 'caretaker'
    ? 'Unable to create your caretaker profile. Try again or contact support.'
    : 'Unable to create your profile. Try again or contact support.';
}

function postgrestErrorDetail(
  err: { message?: string } | null,
): string | undefined {
  const trimmed = err?.message?.trim();
  return trimmed === '' ? undefined : trimmed;
}

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
): Promise<EnsureProfileRowResult> {
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
    return {
      ok: false,
      message: PROFILE_READ_ERROR_MESSAGE,
      cause: postgrestErrorDetail(readErr),
    };
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
  return {
    ok: false,
    message: profileInsertErrorMessage(appRole),
    cause: postgrestErrorDetail(insErr),
  };
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
): Promise<EnsureProfileRowResult> {
  return ensureProfileRow(client, userId, 'patient');
}
