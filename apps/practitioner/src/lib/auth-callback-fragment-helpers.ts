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
 * True when `err` is a Supabase Auth API error from `getUser()` / `setSession()` (not a config throw).
 *
 * @param err - Value from `catch` or `getUser()` `error`.
 */
export function isSupabaseAuthApiError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    '__isAuthError' in err &&
    (err as { __isAuthError?: boolean }).__isAuthError === true
  );
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
