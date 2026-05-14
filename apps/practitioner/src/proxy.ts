import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

const protectedRoutes = ['/patients'];

/**
 * True when `pathname` is exactly `route` or a nested path under it.
 */
function isProtectedPath(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

const authRoutes = ['/login'];

function withSupabaseCookies(
  response: NextResponse,
  supabaseResponse: NextResponse,
) {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    const { name, value, ...rest } = cookie as {
      name: string;
      value: string;
      options?: Record<string, unknown>;
      [key: string]: unknown;
    };

    const options =
      'options' in rest && rest.options
        ? (rest.options as Record<string, unknown>)
        : Object.keys(rest).length > 0
          ? (rest as Record<string, unknown>)
          : undefined;

    response.cookies.set(name, value, options);
  });

  return response;
}

/**
 * Next.js 16 **proxy** (replaces `middleware.ts`): session refresh, auth-route redirects, and the
 * Supabase implicit-auth rewrite for `/auth/callback` (same pattern as `apps/web/src/proxy.ts`).
 */
export default async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  /**
   * Implicit Supabase auth puts tokens in `#…` only; the fragment never reaches the server.
   * `NextResponse.rewrite` must run here (proxy), not in `app/auth/callback/route.ts`—Next does not
   * apply rewrites from Route Handlers the same way, which produced broken invite links.
   */
  if (pathname === '/auth/callback' && !searchParams.has('code')) {
    const fragmentUrl = new URL('/auth/callback/fragment', req.url);
    const qs = searchParams.toString();
    fragmentUrl.search = req.nextUrl.search || (qs ? `?${qs}` : '');
    return NextResponse.rewrite(fragmentUrl);
  }

  let supabaseResponse = NextResponse.next({
    request: req,
  });

  const isProtectedRoute = protectedRoutes.some((route) =>
    isProtectedPath(pathname, route),
  );

  const isAuthRoute = authRoutes.includes(pathname);

  const supabase = createSupabaseServerClient({
    getAll() {
      return req.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) => {
        req.cookies.set(name, value);
      });

      supabaseResponse = NextResponse.next({
        request: req,
      });

      cookiesToSet.forEach(({ name, value, options }) => {
        supabaseResponse.cookies.set(name, value, options);
      });
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedRoute && !user) {
    return withSupabaseCookies(
      NextResponse.redirect(new URL('/login', req.url)),
      supabaseResponse,
    );
  }

  if (isAuthRoute && user) {
    return withSupabaseCookies(
      NextResponse.redirect(new URL('/', req.url)),
      supabaseResponse,
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
