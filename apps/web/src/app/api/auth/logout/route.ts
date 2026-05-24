import { getSameOriginLogoutPostFailure } from '@/lib/same-origin-logout-post';
import { createServerClient } from '../../../../lib/supabase/server-client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Signs out the current user-web session and clears auth cookies. Supports optional
 * `?scope=global` to revoke refresh tokens on all devices.
 *
 * Rejects cross-site `POST` requests (same-origin / `Sec-Fetch-Site` / `Referer` checks) before
 * mutating session state, to mitigate CSRF-driven logouts.
 *
 * @param request - Incoming request with current cookies.
 * @returns Redirect to login, or **400** / **403** when same-origin validation fails.
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

  const supabase = await createServerClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    },
  });

  const scopeParam = request.nextUrl.searchParams.get('scope');
  const scope = scopeParam === 'global' ? 'global' : undefined;

  await supabase.auth.signOut(scope ? { scope } : undefined);

  return response;
}
