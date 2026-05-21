'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';
import { usePathname } from 'next/navigation';

import { isPublicWebPath } from '@/lib/web-public-paths';

/**
 * User-web root `not-found` content: avoids a nested `<main>` when `(public)/layout` already
 * provides the landmark.
 *
 * @returns Themed 404 panel with optional main wrapper.
 */
export function WebNotFoundBoundary() {
  const pathname = usePathname() ?? '/';

  return <AppNotFoundPage wrapInMain={!isPublicWebPath(pathname)} />;
}
