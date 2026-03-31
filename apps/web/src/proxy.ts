import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

// Protected routes that require authentication
const protectedRoutes = ['/dashboard'];

// Public auth routes that redirect authenticated users
const authRoutes = ['/login', '/signup'];

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
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Handle auth routes: redirect authenticated users to home
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return supabaseResponse;
}

// Matcher config: apply to all routes except API, static files, and images
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
