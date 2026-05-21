'use client';

import {
  AppShellWithSideNav,
  AppSideNav,
  type AppSideNavLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef, type ReactNode } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
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
    return <main id="main-content">{children}</main>;
  }

  const email = session.user.email;

  return (
    <AppShellWithSideNav
      sidebarCookieName="abstrack_practitioner_sidebar_state"
      skipLink={
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-app-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-app-ink focus:shadow-soft focus:outline-none focus:ring-2 focus:ring-app-ring focus:ring-offset-2 focus:ring-offset-app-bg"
        >
          Skip to main content
        </a>
      }
      sideNav={
        <AppSideNav
          pathname={pathname}
          items={PRACTITIONER_APP_NAV_ITEMS}
          LinkComponent={PractitionerNavLink}
          accessibilityLabel="Practitioner application"
          brand={
            <Link
              href="/"
              className="block rounded-lg outline-none ring-offset-2 ring-offset-app-bg transition hover:text-app-primary focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              <span className="block text-lg font-bold tracking-tight text-sidebar-foreground">
                ABStrack
              </span>
              <span className="mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Practitioner
              </span>
            </Link>
          }
          footer={
            <div className="flex flex-col gap-3">
              {email ? (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={email}
                  aria-label={`Signed in as ${email}`}
                >
                  {email}
                </p>
              ) : null}
              <ThemeMenu />
            </div>
          }
        />
      }
      mainClassName="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
      mobileMenuTriggerLabel="Open practitioner navigation menu"
    >
      {children}
    </AppShellWithSideNav>
  );
}
