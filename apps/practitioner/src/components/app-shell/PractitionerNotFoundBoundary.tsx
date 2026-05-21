'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';
import { usePathname } from 'next/navigation';

import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

/**
 * Practitioner root `not-found` content: avoids a nested `<main>` on public routes that supply
 * their own `<main>` landmark.
 *
 * @returns Themed 404 panel with optional main wrapper.
 */
export function PractitionerNotFoundBoundary() {
  const pathname = usePathname() ?? '/';

  return <AppNotFoundPage wrapInMain={!isPublicPractitionerPath(pathname)} />;
}
