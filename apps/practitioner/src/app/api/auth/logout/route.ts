import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Signs out the current practitioner session and clears auth cookies (full Supabase sign-out).
 * Revokes refresh tokens server-side; the MFA “trusted device” bundle in `localStorage` may be
 * stale until the next sign-in attempt clears it. Prefer the in-app Log out control for trust-aware
 * sign-out when available.
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
