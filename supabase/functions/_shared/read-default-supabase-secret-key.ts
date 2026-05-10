/**
 * Default secret API key from Edge / local `SUPABASE_SECRET_KEYS` (JSON map of `sb_secret_…` keys).
 * Supabase injects this in hosted Edge; legacy `SUPABASE_SERVICE_ROLE_KEY` must not be used.
 *
 * @returns The `default` entry, or `null` if unset, empty, or malformed.
 * @see https://supabase.com/docs/guides/functions/secrets
 */
export function readDefaultSupabaseSecretKeyFromEnv(): string | null {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw == null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const v = (parsed as Record<string, unknown>)['default'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
