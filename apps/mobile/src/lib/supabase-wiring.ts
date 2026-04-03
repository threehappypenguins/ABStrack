import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import * as SecureStore from 'expo-secure-store';
import { createSupabaseNativeClient } from '@abstrack/supabase/native';

/**
 * Securely persists Supabase JWT tokens using OS-backed encrypted storage (Keychain on iOS, Keystore on Android).
 * Uses expo-secure-store which encrypts data at rest and limits each key to 2048 bytes.
 * This satisfies HIPAA/PHIA requirements by avoiding unencrypted token storage.
 */
const mobileAuthStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export function createMobileSupabaseClient(): AbstrackSupabaseClient {
  return createSupabaseNativeClient(mobileAuthStorage);
}

let mobileSupabaseClient: AbstrackSupabaseClient | null = null;

export function getMobileSupabaseClient(): AbstrackSupabaseClient {
  if (!mobileSupabaseClient) {
    mobileSupabaseClient = createMobileSupabaseClient();
  }

  return mobileSupabaseClient;
}
