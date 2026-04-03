import { createBrowserClient as createBrowserSupabaseClient } from '@supabase/ssr';
import type { AbstrackSupabaseClient, Database } from '@abstrack/supabase';
import { getSupabaseClientKey, getSupabaseUrl } from './env';

export function createBrowserClient(): AbstrackSupabaseClient {
  return createBrowserSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseClientKey(),
  ) as unknown as AbstrackSupabaseClient;
}
