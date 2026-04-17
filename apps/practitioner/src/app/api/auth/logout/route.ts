import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getSameOriginLogoutPostFailure } from '@/lib/same-origin-logout-post';

/**
 * Signs out the current practitioner session and clears auth cookies (full Supabase sign-out).
 * Revokes refresh tokens server-side; the MFA “trusted device” bundle in `localStorage` may be
 * stale until the next sign-in attempt clears it. Prefer the in-app Log out control for trust-aware
 * sign-out when available.
 *
 * Rejects cross-site `POST` requests (same-origin / `Sec-Fetch-Site` / `Referer` checks) before
 * mutating session state, to mitigate CSRF-driven logouts.
 *
 * @param request - Incoming request with current cookies.
 * @returns Redirect response to practitioner login, or 403 when origin validation fails.
 */
export async function POST(request: NextRequest) {
  const csrfFailure = getSameOriginLogoutPostFailure(request);
  if (csrfFailure) {
    return NextResponse.json(
      { error: csrfFailure.error },
      { status: csrfFailure.status },
    );
  }

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
