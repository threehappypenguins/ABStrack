import { createServerClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';
import type { Database } from './database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

export type { CookieMethodsServer };

/**
 * Next.js server components, route handlers, and middleware: pass cookie methods from
 * `next/headers` / `NextRequest` / `NextResponse` per Supabase SSR guides.
 * Use **publishable/anon** key only — never the service role key.
 */
export function createSupabaseServerClient(cookies: CookieMethodsServer) {
  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    { cookies },
  );
}
