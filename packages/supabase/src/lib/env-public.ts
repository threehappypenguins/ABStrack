/**
 * Client-safe Supabase URL and publishable (anon) key resolution.
 * Documented names: `packages/supabase/README.md`, `.env.example`, `docs/DEV_SETUP.md`.
 *
 * Server-only secrets (`SUPABASE_SECRET_KEY`, etc.) live in `admin-client.ts` and are not
 * imported from the main package entry.
 */

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
  const v = process.env[name];
  return v === '' ? undefined : v;
}

/** Project URL (Next, Expo, or generic server `SUPABASE_URL`). */
export function getSupabaseUrl(): string {
  const url =
    readEnv('NEXT_PUBLIC_SUPABASE_URL') ??
    readEnv('EXPO_PUBLIC_SUPABASE_URL') ??
    readEnv('SUPABASE_URL');
  if (!url) {
    throw new Error(
      'Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_URL, or SUPABASE_URL.',
    );
  }
  return url;
}

/**
 * Publishable or legacy anon JWT — safe for browsers and mobile bundles.
 * Never use the service role / secret key here.
 */
export function getSupabasePublishableKey(): string {
  const key =
    readEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ??
    readEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ??
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ??
    readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!key) {
    throw new Error(
      'Missing Supabase publishable/anon key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy *_ANON_KEY).',
    );
  }
  return key;
}
