'use client';

import {
  AppShellWithSideNav,
  AppSideNav,
  ABSTRACK_WEB_TAGLINE,
  AppTopNav,
  type AppSideNavLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef, type ReactNode } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { PractitionerSignOutButton } from '@/components/practitioner-sign-out-button';
import { useAuth } from '@/lib/auth-provider';
import { PRACTITIONER_APP_NAV_ITEMS } from '@/lib/practitioner-nav-items';
import { isPublicPractitionerPath } from '@/lib/practitioner-public-paths';

const PractitionerNavLink = forwardRef<HTMLAnchorElement, AppSideNavLinkProps>(
  ({ href, children, ...rest }, ref) => (
    <Link href={href} ref={ref} {...rest}>
      {children}
    </Link>
  ),
);
PractitionerNavLink.displayName = 'PractitionerNavLink';

export type PractitionerAppShellProps = {
  children: ReactNode;
};

/**
 * Practitioner chrome with side navigation when the user has a session and the route is not
 * public (login, invite, password reset, auth callback). Uses shadcn/ui sidebar with themed tokens.
 *
 * @param props - Layout children.
 * @returns Shell, a layout `<main>` while auth is resolving on private routes, or unwrapped
 * children on public routes (each public page supplies its own single `<main>` landmark).
 */
export function PractitionerAppShell({ children }: PractitionerAppShellProps) {
  const pathname = usePathname() ?? '/';
  const { session, loading } = useAuth();

  if (isPublicPractitionerPath(pathname)) {
    return <>{children}</>;
  }

  if (loading || !session) {
    const minHeightClass = loading
      ? 'min-h-svh'
      : 'min-h-[calc(100svh-4.5rem)]';

    return (
      <main
        id="main-content"
        className={`app-grid-background flex min-w-0 flex-col ${minHeightClass}`}
      >
        {children}
      </main>
    );
  }

  const email = session.user.email;

  return (
    <AppShellWithSideNav
      sidebarTopOffset="4.5rem"
      sidebarCookieName="abstrack_practitioner_sidebar_state"
      skipLink={
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-app-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-app-ink focus:shadow-soft focus:outline-none focus:ring-2 focus:ring-app-ring focus:ring-offset-2 focus:ring-offset-app-bg"
        >
          Skip to main content
        </a>
      }
      topHeader={
        <AppTopNav
          brandHref="/"
          brandLinkComponent={PractitionerNavLink}
          tagline={ABSTRACK_WEB_TAGLINE}
          email={email}
          themeMenu={<ThemeMenu />}
          showSidebarTrigger
          actions={<PractitionerSignOutButton />}
          sidebarTriggerAriaLabel="Open practitioner navigation menu"
          mobileSheetTitle="Account"
          mobileSheetDescription="Signed-in account, sign out, and appearance settings."
          mobileMenuTriggerAriaLabel="Open account menu"
        />
      }
      sideNav={
        <AppSideNav
          pathname={pathname}
          items={PRACTITIONER_APP_NAV_ITEMS}
          LinkComponent={PractitionerNavLink}
          accessibilityLabel="Practitioner application"
        />
      }
      mainClassName="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
    >
      {children}
    </AppShellWithSideNav>
  );
}
