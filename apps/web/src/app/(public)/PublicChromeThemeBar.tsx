'use client';

import { usePathname } from 'next/navigation';
import { ThemeMenu } from '@/components/theme/ThemeMenu';

/**
 * Theme control for public routes other than `/` (the landing page embeds its own
 * {@link ThemeMenu} in the marketing header).
 *
 * @returns Top-aligned theme row or null on the landing route.
 */
export function PublicChromeThemeBar() {
  const pathname = usePathname();
  if (pathname === '/') {
    return null;
  }
  return (
    <div className="relative z-50 flex justify-end border-b border-app-border/80 bg-app-surface/90 px-4 py-2 sm:px-6">
      <ThemeMenu />
    </div>
  );
}
