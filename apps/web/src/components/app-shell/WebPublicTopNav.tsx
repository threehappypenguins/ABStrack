'use client';

import {
  ABSTRACK_USER_WEB_TAGLINE,
  ACCOUNT_ACTIONS_SURFACE_CLASS,
  AppTopNav,
  type AppTopNavBrandLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef, useMemo, type ReactNode } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { useAuth } from '@/lib/auth-provider';
import { isPublicWebPath } from '@/lib/web-public-paths';
import { LandingTopNavActions } from './LandingTopNavActions';

const WebPublicNavLink = forwardRef<HTMLAnchorElement, AppTopNavBrandLinkProps>(
  ({ href, children, ...rest }, ref) => (
    <Link href={href} ref={ref} {...rest}>
      {children}
    </Link>
  ),
);
WebPublicNavLink.displayName = 'WebPublicNavLink';

/**
 * Resolves trailing top-nav actions for public user-web routes.
 *
 * @param pathname - Current pathname from the app router.
 * @returns Actions slot for {@link AppTopNav}, or `null` when none apply.
 */
function resolvePublicTopNavActions(pathname: string): ReactNode {
  if (pathname === '/') {
    return <LandingTopNavActions />;
  }
  if (pathname === '/login') {
    return (
      <Link href="/signup" className={ACCOUNT_ACTIONS_SURFACE_CLASS}>
        Sign up
      </Link>
    );
  }
  if (pathname === '/signup') {
    return (
      <Link href="/login" className={ACCOUNT_ACTIONS_SURFACE_CLASS}>
        Login
      </Link>
    );
  }
  return null;
}

/**
 * Shared top navigation for public user-web routes (landing, login, sign-up, etc.).
 *
 * @returns Sticky header on public routes; `null` on private routes while signed in or while auth
 * is still resolving (avoids public chrome flashing before {@link AuthenticatedShell}).
 */
export function WebPublicTopNav() {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();
  const actions = useMemo(
    () => resolvePublicTopNavActions(pathname),
    [pathname],
  );

  if (!isPublicWebPath(pathname) && (loading || session)) {
    return null;
  }

  return (
    <AppTopNav
      brandHref="/"
      brandLinkComponent={WebPublicNavLink}
      tagline={ABSTRACK_USER_WEB_TAGLINE}
      themeMenu={<ThemeMenu />}
      actions={actions}
      mobileSheetTitle="Menu"
      mobileSheetDescription="Sign-in options and appearance settings."
      mobileMenuTriggerAriaLabel="Open menu"
    />
  );
}
