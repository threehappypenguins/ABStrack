import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient(cookieStore);

  await supabase.auth.signOut();

  // Redirect to login page after logout
  return NextResponse.redirect(new URL('/login', request.url));
}
