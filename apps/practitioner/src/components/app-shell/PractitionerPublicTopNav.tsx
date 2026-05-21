'use client';

import {
  ABSTRACK_WEB_TAGLINE,
  AppTopNav,
  type AppTopNavBrandLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { useAuth } from '@/lib/auth-provider';
import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

const PractitionerPublicNavLink = forwardRef<
  HTMLAnchorElement,
  AppTopNavBrandLinkProps
>(({ href, children, ...rest }, ref) => (
  <Link href={href} ref={ref} {...rest}>
    {children}
  </Link>
));
PractitionerPublicNavLink.displayName = 'PractitionerPublicNavLink';

/**
 * Shared top navigation on public practitioner routes (login, invite, password reset).
 * No self-service registration link — practitioners join via invite only.
 *
 * @returns Sticky header on public routes; `null` on private routes while signed in or while auth
 * is still resolving (avoids public chrome flashing before {@link PractitionerAppShell}).
 */
export function PractitionerPublicTopNav() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();
  const isPublic = isPublicPractitionerPath(pathname);

  if (!isPublic && (loading || session)) {
    return null;
  }

  return (
    <AppTopNav
      brandHref="/"
      brandLinkComponent={PractitionerPublicNavLink}
      tagline={ABSTRACK_WEB_TAGLINE}
      themeMenu={<ThemeMenu />}
      mobileSheetTitle="Menu"
      mobileSheetDescription="Appearance settings."
      mobileMenuTriggerAriaLabel="Open menu"
    />
  );
}
