/**
 * Client-safe Supabase URL and **publishable** key resolution.
 * Documented names: `packages/supabase/README.md`, `.env.example`, `docs/DEV_SETUP.md`.
 *
 * **Static `process.env.NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` reads only** — Next.js and Expo
 * inline these at build time only when the property access is statically analyzable.
 * Dynamic `process.env[name]` breaks inlining, so client bundles can miss configured values.
 *
 * Server-only secrets (`SUPABASE_SECRET_KEY`, etc.) live in `admin-client.ts` and are not
 * imported from the main package entry.
 */

/** Treat missing or empty string as unset (`.env` often uses `VAR=` for optional keys). */
function normalizeEnv(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Project URL. Prefer **`NEXT_PUBLIC_SUPABASE_URL`** (Next) or **`EXPO_PUBLIC_SUPABASE_URL`** (Expo)
 * so the value is available in client bundles. **`SUPABASE_URL`** is only read in environments
 * with a full `process.env` (e.g. Node server); it is **not** exposed to browser or Expo client code.
 */
export function getSupabaseUrl(): string {
  const url =
    normalizeEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
    normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_URL) ??
    normalizeEnv(process.env.SUPABASE_URL);
  if (!url) {
    throw new Error(
      'Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL (Next.js) or EXPO_PUBLIC_SUPABASE_URL (Expo) for client code. SUPABASE_URL is optional and server/Node-only—it is not inlined into browser or mobile bundles.',
    );
  }
  return url;
}

/**
 * Publishable key (`sb_publishable_…`) for browsers and mobile bundles.
 * Never use the secret key or legacy JWT anon env vars here.
 */
export function getSupabasePublishableKey(): string {
  const key =
    normalizeEnv(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!key) {
    throw new Error(
      'Missing Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Next.js) or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Expo).',
    );
  }
  return key;
}
