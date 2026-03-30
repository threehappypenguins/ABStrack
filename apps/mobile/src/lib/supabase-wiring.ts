import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  createSupabaseNativeClient,
  type NativeAuthStorage,
} from '@abstrack/supabase/native';

const memory: Record<string, string> = {};

/** In-memory storage for tests / early wiring; swap for AsyncStorage in production auth flows. */
export const mobileDevAuthStorage: NativeAuthStorage = {
  getItem: (key) => memory[key] ?? null,
  setItem: (key, value) => {
    memory[key] = value;
  },
  removeItem: (key) => {
    delete memory[key];
  },
};

export function createMobileSupabaseClient(): AbstrackSupabaseClient {
  return createSupabaseNativeClient(mobileDevAuthStorage);
}
