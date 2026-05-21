'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';
import { usePathname } from 'next/navigation';
import { useId } from 'react';

import { useAuth } from '@/lib/auth-provider';
import { isPublicWebPath } from '@/lib/web-public-paths';

/**
 * User-web root `not-found` content: wraps in `<main id="main-content">` whenever
 * {@link AuthenticatedShell} is not active (including public-prefix 404s where `(public)/layout`
 * is not in the tree, and signed-out private routes under {@link WebAppShell}'s non-main wrapper).
 *
 * @returns Themed 404 panel with optional main wrapper.
 */
export function WebNotFoundBoundary() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();
  const hasAuthenticatedShell =
    !isPublicWebPath(pathname) && !loading && Boolean(session);
  const headingId = useId();

  return (
    <AppNotFoundPage
      headingId={headingId}
      wrapInMain={!hasAuthenticatedShell}
    />
  );
}
