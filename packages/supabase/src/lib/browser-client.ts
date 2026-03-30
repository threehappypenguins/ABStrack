import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

/**
 * Next.js / web client components. Uses `@supabase/ssr` cookie session handling.
 * Pair with {@link createSupabaseServerClient} on the server (middleware + RSC / routes).
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
  ) as unknown as SupabaseClient<Database>;
}
