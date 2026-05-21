'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-provider';
import { isPublicWebPath } from '@/lib/web-public-paths';

import { AuthenticatedShell } from './AuthenticatedShell';

export type WebAppShellProps = {
  children: ReactNode;
};

/**
 * User-web chrome: authenticated shell on private routes when signed in; otherwise a single
 * grid `<main>` (public pages supply their own landmark via `(public)/layout`).
 *
 * @param props - Layout children.
 * @returns Shell, interim main while auth resolves on private routes, or unwrapped children on
 * public routes.
 */
export function WebAppShell({ children }: WebAppShellProps) {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();

  if (isPublicWebPath(pathname)) {
    return <>{children}</>;
  }

  if (loading || !session) {
    return (
      <main
        id="main-content"
        className="app-grid-background flex min-h-svh min-w-0 flex-col"
      >
        {children}
      </main>
    );
  }

  return (
    <AuthenticatedShell email={session.user.email ?? null}>
      {children}
    </AuthenticatedShell>
  );
}
