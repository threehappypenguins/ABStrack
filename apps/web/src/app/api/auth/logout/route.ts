import { createServerClient } from '../../../../lib/supabase/server-client';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
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

  // Redirect to login page after logout
  return response;
}
