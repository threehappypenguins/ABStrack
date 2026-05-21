'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-provider';
import { isPublicWebPath } from '@/lib/web-public-paths';

/**
 * User-web root `not-found` content: wraps in `<main>` only when no parent landmark exists
 * (signed-out private routes under {@link WebAppShell}'s non-main wrapper). Skips the wrapper on
 * public routes (`(public)/layout` main) and when {@link AuthenticatedShell} is active.
 *
 * @returns Themed 404 panel with optional main wrapper.
 */
export function WebNotFoundBoundary() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();
  const isPublic = isPublicWebPath(pathname);
  const hasAuthenticatedShell = !isPublic && !loading && Boolean(session);

  return <AppNotFoundPage wrapInMain={!isPublic && !hasAuthenticatedShell} />;
}
