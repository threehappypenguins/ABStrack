'use client';

import { usePathname } from 'next/navigation';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { useAuth } from '@/lib/auth-provider';
import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

/**
 * Fixed theme control when the authenticated app shell (sidebar footer) is not shown.
 *
 * @returns Theme menu portal or null.
 */
export function PractitionerPublicThemeBar() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();

  if (loading) {
    return null;
  }

  const usesAppShell = !!session && !isPublicPractitionerPath(pathname);

  if (usesAppShell) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[200] sm:right-4 sm:top-4">
      <div className="pointer-events-auto">
        <ThemeMenu />
      </div>
    </div>
  );
}
