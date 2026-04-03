import { createServerClient as createServerSupabaseClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';
import type { Database } from '@abstrack/supabase';
import { cookies } from 'next/headers';
import { getSupabaseClientKey, getSupabaseUrl } from './env';

export async function createServerClient(cookieMethods?: CookieMethodsServer) {
  if (cookieMethods) {
    return createServerSupabaseClient<Database>(
      getSupabaseUrl(),
      getSupabaseClientKey(),
      { cookies: cookieMethods },
    );
  }

  const cookieStore = await cookies();

  return createServerSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseClientKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
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
  );
}
