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
 * `getMobileAuthSessionSafe` and similar guards so reads can fall back to the persisted session
 * when GoTrue throws (e.g. `TypeError: Network request failed`).
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
