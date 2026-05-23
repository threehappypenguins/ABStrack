'use client';

import {
  ACCOUNT_ACTIONS_SURFACE_CLASS,
  AppShellWithSideNav,
  AppSideNav,
  AppTopNav,
  ABSTRACK_WEB_TAGLINE,
  type AppSideNavLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef, type ReactNode } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { WEB_APP_NAV_ITEMS } from '@/lib/app-nav-items';

const WebNavLink = forwardRef<HTMLAnchorElement, AppSideNavLinkProps>(
  ({ href, children, ...rest }, ref) => (
    <Link href={href} ref={ref} {...rest}>
      {children}
    </Link>
  ),
);
WebNavLink.displayName = 'WebNavLink';

export type AuthenticatedShellProps = {
  children: ReactNode;
  /** Signed-in email when available; omitted in rare dev-only auth-error views. */
  email?: string | null;
};

/**
 * Authenticated app chrome: skip link, full-width top bar, side navigation (shadcn/ui sidebar),
 * and a centered main column. Surfaces use CSS variables so light/dark tracks the theme toggle.
 * Caretaker and practitioner invite management lives under Settings → Invites
 * (patient accounts only).
 *
 * @param props - Props.
 * @returns Shell layout wrapping page content.
 */
export function AuthenticatedShell({
  children,
  email,
}: AuthenticatedShellProps) {
  const pathname = usePathname() ?? '/';

  return (
    <AppShellWithSideNav
      sidebarTopOffset="4.5rem"
      sidebarCookieName="abstrack_web_sidebar_state"
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
          brandHref="/dashboard"
          brandLinkComponent={WebNavLink}
          tagline={ABSTRACK_WEB_TAGLINE}
          email={email}
          themeMenu={<ThemeMenu />}
          showSidebarTrigger
          actions={
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className={ACCOUNT_ACTIONS_SURFACE_CLASS}>
                Log out
              </button>
            </form>
          }
          mobileSheetTitle="Account"
          mobileSheetDescription="Signed-in account, sign out, and appearance settings."
          mobileMenuTriggerAriaLabel="Open account menu"
        />
      }
      sideNav={
        <AppSideNav
          pathname={pathname}
          items={WEB_APP_NAV_ITEMS}
          LinkComponent={WebNavLink}
          accessibilityLabel="ABStrack application"
        />
      }
      mainClassName="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
    >
      {children}
    </AppShellWithSideNav>
  );
}
