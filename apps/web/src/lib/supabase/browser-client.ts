import { createBrowserClient as createBrowserSupabaseClient } from '@supabase/ssr';
import type { Database } from '@abstrack/supabase';
import { getSupabaseClientKey, getSupabaseUrl } from './env';

export function createBrowserClient() {
  return createBrowserSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseClientKey(),
  );
}
