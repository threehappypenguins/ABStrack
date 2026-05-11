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

/**
 * Trims env values and treats missing, empty, or whitespace-only strings as unset (pasted secrets
 * / `.env` lines often include trailing spaces or newlines).
 */
function normalizeEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const t = value.trim();
  return t === '' ? undefined : t;
}

/**
 * Ensures the resolved key is a Supabase **publishable** Data API key, mirroring the **`sb_secret_`**
 * guard in `readDefaultSupabaseSecretKeyFromEnv` for Edge secrets.
 *
 * @param key - Trimmed value from public env (never log the full string).
 * @throws Error when the value is a secret key or not a **`sb_publishable_`** key.
 */
function assertValidSupabasePublishableKeyShape(key: string): void {
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'Invalid Supabase publishable key: the value looks like a secret key (sb_secret_…). Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY with the project publishable key only—never the secret key in client or mobile bundles.',
    );
  }
  if (!key.startsWith('sb_publishable_')) {
    throw new Error(
      'Invalid Supabase publishable key: expected a trimmed sb_publishable_… key (see packages/supabase/README.md and Supabase dashboard API keys).',
    );
  }
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
 * Rejects **`sb_secret_…`** and any value that does not start with **`sb_publishable_`** so a secret
 * key is not accidentally shipped in a client bundle. Never use legacy JWT anon env vars here.
 *
 * @throws Error when missing, wrong shape, or a secret key.
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
  assertValidSupabasePublishableKeyShape(key);
  return key;
}
