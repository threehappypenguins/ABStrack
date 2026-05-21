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
 * grid wrapper without a `<main>` landmark (pages or {@link AuthenticatedShell} supply `main-content`).
 *
 * @param props - Layout children.
 * @returns Shell, interim layout wrapper while auth resolves on private routes, or unwrapped
 * children on public routes.
 */
export function WebAppShell({ children }: WebAppShellProps) {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();

  if (isPublicWebPath(pathname)) {
    return <>{children}</>;
  }

  if (loading || !session) {
    return (
      <div className="app-grid-background flex min-h-[calc(100svh-4.5rem)] min-w-0 flex-col">
        {children}
      </div>
    );
  }

  return (
    <AuthenticatedShell email={session.user.email ?? null}>
      {children}
    </AuthenticatedShell>
  );
}
