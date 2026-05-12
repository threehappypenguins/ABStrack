import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  getSafeAuthCallbackRedirectPath,
} from '@/lib/auth/auth-callback-redirect';
import { createServerClient } from '@/lib/supabase/server-client';

function redirectWithError(
  request: NextRequest,
  redirectPath: string,
  message: string,
) {
  const url = new URL(redirectPath, request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

/**
 * PKCE email / OAuth return: exchange `?code=` on the server so `@supabase/ssr` can attach session
 * cookies. Implicit auth (`#access_token=…` only) is rewritten to `/auth/callback/fragment` in
 * `src/proxy.ts` (middleware); this handler returns **400** if it receives a request
 * without `code` (e.g. direct hits without middleware).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const redirectPath = getSafeAuthCallbackRedirectPath(
    request.nextUrl.searchParams.get('next'),
  );

  if (!code) {
    // Implicit auth is rewritten to `/auth/callback/fragment` in `src/proxy.ts` (middleware).
    return NextResponse.json(
      {
        error:
          'Missing authorization code. Open this URL from your invite email, or contact support.',
      },
      { status: 400 },
    );
  }

  try {
    let response = NextResponse.redirect(new URL(redirectPath, request.url));

    const supabase = await createServerClient({
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.redirect(new URL(redirectPath, request.url));

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectWithError(
        request,
        redirectPath,
        AUTH_CALLBACK_INVALID_LINK_MESSAGE,
      );
    }

    return response;
  } catch {
    return redirectWithError(
      request,
      redirectPath,
      AUTH_CALLBACK_INVALID_LINK_MESSAGE,
    );
  }
}
