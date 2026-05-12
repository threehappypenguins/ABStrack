/**
 * Default secret API key from Edge / local `SUPABASE_SECRET_KEYS` (JSON map of `sb_secret_…` keys).
 * Supabase injects this in hosted Edge; legacy `SUPABASE_SERVICE_ROLE_KEY` must not be used.
 *
 * The env value and the JSON `default` string are **trimmed** so pasted whitespace/newlines from
 * secret managers do not produce an invalid key for `createClient`.
 *
 * @returns The trimmed `default` entry when it looks like `sb_secret_…`, or `null` if unset,
 * empty, malformed, or wrong shape.
 * @see https://supabase.com/docs/guides/functions/secrets
 */
export function readDefaultSupabaseSecretKeyFromEnv(): string | null {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw == null || raw === '') {
    return null;
  }
  const rawTrimmed = raw.trim();
  if (rawTrimmed === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTrimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const v = (parsed as Record<string, unknown>)['default'];
  if (typeof v !== 'string') {
    return null;
  }
  const key = v.trim();
  if (key.length === 0) {
    return null;
  }
  if (!key.startsWith('sb_secret_')) {
    console.error(
      'SUPABASE_SECRET_KEYS.default must be a trimmed sb_secret_… API key.',
    );
    return null;
  }
  return key;
}
