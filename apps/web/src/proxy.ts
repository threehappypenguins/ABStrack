import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

// Protected routes that require authentication
const protectedRoutes = ['/dashboard'];

// Public auth routes that redirect authenticated users
const authRoutes = ['/login', '/signup'];

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
        : (Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : undefined);

    response.cookies.set(name, value, options);
  });

  return response;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let supabaseResponse = NextResponse.next({
    request: req,
  });

  // Check if current route is protected
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // Check if current route is an auth route
  const isAuthRoute = authRoutes.includes(pathname);

  // Get session by calling supabase.auth.getUser() on every request
  // This refreshes the session from the Auth server (validates refresh token if needed)
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

  // Handle protected routes: redirect to login if not authenticated
  if (isProtectedRoute && !user) {
    return withSupabaseCookies(
      NextResponse.redirect(new URL('/login', req.url)),
      supabaseResponse,
    );
  }

  // Handle auth routes: redirect authenticated users to home
  if (isAuthRoute && user) {
    return withSupabaseCookies(
      NextResponse.redirect(new URL('/', req.url)),
      supabaseResponse,
    );
  }

  return supabaseResponse;
}

// Matcher config: apply to all routes except API, static files, and images
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
