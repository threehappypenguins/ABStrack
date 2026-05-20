'use client';

import { usePathname } from 'next/navigation';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { useAuth } from '@/lib/auth-provider';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/invite',
  '/update-password',
  '/auth',
] as const;

function isPublicPractitionerPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

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
