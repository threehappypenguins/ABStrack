import { createServerClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

export type { CookieMethodsServer };

/**
 * Next.js server components, route handlers, and middleware: pass cookie methods from
 * `next/headers` / `NextRequest` / `NextResponse` per Supabase SSR guides.
 * Use the **publishable** key only — never the secret / service-role key.
 */
export function createSupabaseServerClient(
  cookies: CookieMethodsServer,
): SupabaseClient<Database> {
  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    { cookies },
  ) as unknown as SupabaseClient<Database>;
}
