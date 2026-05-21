'use client';

import { usePathname } from 'next/navigation';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { useAuth } from '@/lib/auth-provider';
import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

/**
 * Fixed theme control when the authenticated app shell (sidebar footer) is not shown.
 * Always renders on public routes (including while auth is loading) so login/invite pages
 * never flash without a theme toggle.
 *
 * @returns Theme menu portal or null.
 */
export function PractitionerPublicThemeBar() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();
  const isPublic = isPublicPractitionerPath(pathname);

  if (!isPublic && !loading && session) {
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
