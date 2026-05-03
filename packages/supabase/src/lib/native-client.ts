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
 * **`autoRefreshToken: false`:** `@supabase/auth-js` treats React Native as a non-browser
 * environment and, when `autoRefreshToken` is true, runs a continuous `setInterval` refresh loop.
 * Failed refresh / lock paths can surface as **unhandled** `TypeError: Network request failed`
 * in Hermes when the device is offline. ABStrack triggers a best-effort
 * `auth.refreshSession()` from the mobile app when the process returns to foreground instead
 * (see `App.tsx` `AppState` listener).
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
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
