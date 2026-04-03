import { createServerClient as createServerSupabaseClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';
import type { AbstrackSupabaseClient, Database } from '@abstrack/supabase';
import { getSupabaseClientKey, getSupabaseUrl } from './env';

type ServerCookiesToSet = Parameters<
  NonNullable<CookieMethodsServer['setAll']>
>[0];

export async function createServerClient(
  cookieMethods?: CookieMethodsServer,
): Promise<AbstrackSupabaseClient> {
  if (cookieMethods) {
    return createServerSupabaseClient<Database>(
      getSupabaseUrl(),
      getSupabaseClientKey(),
      { cookies: cookieMethods },
    ) as unknown as AbstrackSupabaseClient;
  }

  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();

  return createServerSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseClientKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: ServerCookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server components can be read-only for cookies; middleware/route handlers should handle refresh writes.
          }
        },
      },
    },
  ) as unknown as AbstrackSupabaseClient;
}
