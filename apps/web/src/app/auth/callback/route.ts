import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server-client';

const DEFAULT_REDIRECT_PATH = '/update-password';

function getSafeRedirectPath(nextParam: string | null): string {
  if (!nextParam || !nextParam.startsWith('/') || nextParam.startsWith('//')) {
    return DEFAULT_REDIRECT_PATH;
  }

  try {
    // Dummy base only — validates `next` is a same-origin relative path, not an external URL.
    const parseBase = 'https://example.com';
    const parsed = new URL(nextParam, parseBase);
    if (parsed.origin !== parseBase) {
      return DEFAULT_REDIRECT_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_REDIRECT_PATH;
  }
}

function redirectWithError(
  request: NextRequest,
  redirectPath: string,
  message: string,
) {
  const url = new URL(redirectPath, request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const redirectPath = getSafeRedirectPath(
    request.nextUrl.searchParams.get('next'),
  );

  if (!code) {
    return redirectWithError(
      request,
      redirectPath,
      'This reset link is invalid or expired. Request a new one.',
    );
  }

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
      'This reset link is invalid or expired. Request a new one.',
    );
  }

  return response;
}
