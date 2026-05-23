import { isAuthSessionMissingError } from '@abstrack/supabase';

/**
 * Result of interpreting `getUser()` during auth callback fragment handling.
 */
export type AuthCallbackGetUserProbe =
  | { status: 'authenticated'; userId: string }
  | { status: 'signed_out' }
  | { status: 'verification_failed'; error: unknown };

/**
 * Maps `getUser()` to callback flow outcomes. `AuthSessionMissingError` is “signed out”
 * (invalid link after hash handling), not a fatal verification error.
 *
 * @param user - `data.user` from `getUser()`.
 * @param error - `error` from `getUser()`.
 * @returns Probe result for the fragment callback handler.
 */
export function interpretAuthCallbackGetUserProbe(
  user: { id?: string | null } | null | undefined,
  error: unknown,
): AuthCallbackGetUserProbe {
  if (error) {
    if (isAuthSessionMissingError(error)) {
      return { status: 'signed_out' };
    }
    return { status: 'verification_failed', error };
  }
  const id = user?.id;
  if (typeof id === 'string' && id.length > 0) {
    return { status: 'authenticated', userId: id };
  }
  return { status: 'signed_out' };
}

/**
 * Parses Supabase Auth implicit-flow parameters from the URL hash
 * (`#access_token=…&refresh_token=…`). The fragment is never sent to the server.
 *
 * @param hash - `window.location.hash` or equivalent (may include leading `#`).
 * @returns Key/value map of hash query parameters.
 */
export function parseImplicitHashParams(hash: string): Record<string, string> {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * True when `getSupabaseBrowserClient()` failed because URL / publishable key env is missing or invalid.
 *
 * @param err - Value from `catch`.
 */
export function isSupabaseBrowserConfigError(err: unknown): err is Error {
  if (!(err instanceof Error)) {
    return false;
  }
  const { message } = err;
  return (
    message.includes('NEXT_PUBLIC_SUPABASE_URL') ||
    message.includes('Missing Supabase URL') ||
    message.includes('Missing Supabase publishable key') ||
    message.includes('Invalid Supabase publishable key') ||
    message.includes('sb_publishable_') ||
    message.includes('sb_secret_')
  );
}
