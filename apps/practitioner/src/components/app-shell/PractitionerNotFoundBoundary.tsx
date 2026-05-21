'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';
import { usePathname } from 'next/navigation';
import { useId } from 'react';

import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

/**
 * Practitioner root `not-found` content: wraps in `<main>` on public routes (each page normally
 * supplies its own landmark; unmatched paths under `/login`, `/invite`, etc. do not). Private
 * routes use {@link PractitionerAppShell}'s `<main id="main-content">` instead.
 *
 * @returns Themed 404 panel with optional main wrapper.
 */
export function PractitionerNotFoundBoundary() {
  const pathname = usePathname() ?? '/';
  const headingId = useId();

  return (
    <AppNotFoundPage
      headingId={headingId}
      wrapInMain={isPublicPractitionerPath(pathname)}
    />
  );
}
