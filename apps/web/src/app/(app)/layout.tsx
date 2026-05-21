import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server-client';

/**
 * Authenticated area: shared shell, session gate (aligned with dashboard dev-only auth-error escape hatch).
 *
 * @param props - Layout props.
 * @returns Shell-wrapped subtree.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  const allowDevAuthErrorDebugView =
    process.env.NODE_ENV !== 'production' && !!getUserError;

  if (getUserError) {
    console.error(
      'Failed to fetch authenticated user for app layout',
      getUserError,
    );
  }

  if (!user && !allowDevAuthErrorDebugView) {
    redirect('/login');
  }

  return children;
}
