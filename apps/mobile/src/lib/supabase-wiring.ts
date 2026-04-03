import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSupabaseNativeClient } from '@abstrack/supabase/native';

export function createMobileSupabaseClient(): AbstrackSupabaseClient {
  return createSupabaseNativeClient(AsyncStorage);
}

let mobileSupabaseClient: AbstrackSupabaseClient | null = null;

export function getMobileSupabaseClient(): AbstrackSupabaseClient {
  if (!mobileSupabaseClient) {
    mobileSupabaseClient = createMobileSupabaseClient();
  }

  return mobileSupabaseClient;
}
