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
 * helper still returns `session.user` with a redacted `access_token` so identity stays available
 * offline without exposing a live bearer until refresh succeeds.
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
