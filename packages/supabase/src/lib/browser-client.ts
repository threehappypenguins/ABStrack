import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

/**
 * Next.js / web client components. Uses `@supabase/ssr` cookie session handling.
 * Pair with {@link createSupabaseServerClient} on the server (middleware + RSC / routes).
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
  );
}
