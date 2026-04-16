import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Signs out the current practitioner session and clears auth cookies.
 *
 * @param request - Incoming request with current cookies.
 * @returns Redirect response to practitioner login.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);

  const supabase = createSupabaseServerClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    },
  });

  await supabase.auth.signOut();
  return response;
}
