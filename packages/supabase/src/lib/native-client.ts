import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

/** Async-capable storage adapter for auth session persistence (e.g. `expo-secure-store` for encrypted OS Keychain/Keystore, or `@react-native-async-storage/async-storage` for unencrypted fallback). */
export type NativeAuthStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

export type NativeClientOptions = {
  url?: string;
  key?: string;
};

/**
 * React Native / Expo: pass a storage adapter (e.g. `expo-secure-store` for encrypted persistent auth session storage via OS Keychain/Keystore).
 * Optional overrides for URL/key (defaults read `EXPO_PUBLIC_*` from the Metro bundle).
 *
 * **`autoRefreshToken: true`:** `@supabase/auth-js` schedules refresh from the JWT lifetime so
 * access tokens renew while the app stays **foregrounded** past expiry. Without this, only
 * foreground `AppState` nudges (see mobile `App.tsx`) would refresh, and long continuous sessions
 * could break Supabase/PowerSync until the user backgrounded the app.
 *
 * Offline refresh attempts may still fail at the network layer; the mobile app uses
 * `getMobileAuthSessionSafe` so reads can fall back to persisted storage when GoTrue throws (e.g.
 * `TypeError: Network request failed`). When the stored access JWT is already past `exp`, that
 * helper may return `session.user` with an **empty `access_token`** (redacted) while still including
 * other persisted session fields—**including `refresh_token` when present in storage**—so identity
 * stays available offline and refresh can resume when the network returns. An empty `access_token`
 * must not be used as a live REST/PowerSync bearer until refresh repopulates it; callers should not
 * treat the whole returned session as identity-only.
 */
export function createSupabaseNativeClient(
  storage: NativeAuthStorage,
  options?: NativeClientOptions,
) {
  const url = options?.url ?? getSupabaseUrl();
  const key = options?.key ?? getSupabasePublishableKey();
  return createClient<Database>(url, key, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
