'use client';

import {
  AppShellWithSideNav,
  AppSideNav,
  SidebarTrigger,
  type AppSideNavLinkProps,
} from '@abstrack/ui-web';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef, type ReactNode } from 'react';
import { useMemo } from 'react';

import { ThemeMenu } from '@/components/theme/ThemeMenu';
import { WEB_APP_NAV_ITEMS } from '@/lib/app-nav-items';
import { useWebPhiSubjectUserContext } from '@/lib/patient/use-web-phi-subject-user-context';

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
 * Patient-only Caretaker and Practitioner settings links follow
 * {@link useWebPhiSubjectUserContext} (`profileAppRole === 'patient'`).
 *
 * @param props - Props.
 * @returns Shell layout wrapping page content.
 */
export function AuthenticatedShell({
  children,
  email,
}: AuthenticatedShellProps) {
  const pathname = usePathname() ?? '/';
  const { profileAppRole } = useWebPhiSubjectUserContext();
  const navItems = useMemo(() => {
    if (profileAppRole !== 'patient') {
      return WEB_APP_NAV_ITEMS.filter(
        (item) =>
          item.href !== '/settings/caretaker' &&
          item.href !== '/settings/practitioner',
      );
    }
    return WEB_APP_NAV_ITEMS;
  }, [profileAppRole]);

  return (
    <AppShellWithSideNav
      skipLink={
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-app-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-app-ink focus:shadow-soft focus:outline-none focus:ring-2 focus:ring-app-ring focus:ring-offset-2 focus:ring-offset-app-bg"
        >
          Skip to main content
        </a>
      }
      topHeader={
        <header
          className="sticky top-0 z-50 w-full shrink-0 overflow-visible border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] shadow-header backdrop-blur-md supports-[backdrop-filter]:bg-[var(--app-header-bg)]"
          style={
            { '--app-shell-header-height': '4.5rem' } as React.CSSProperties
          }
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
            <SidebarTrigger
              className="min-h-11 min-w-11 shrink-0 text-app-ink md:hidden"
              aria-label="Open navigation menu"
            />
            <Link
              href="/dashboard"
              className="shrink-0 rounded-lg outline-none ring-offset-2 ring-offset-app-bg transition hover:text-app-primary focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              <span className="block text-lg font-bold tracking-tight text-app-ink">
                ABStrack
              </span>
              <span className="mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-app-muted">
                Health tracking
              </span>
            </Link>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              {email ? (
                <p
                  className="max-w-[min(100%,14rem)] truncate text-right text-xs text-app-muted"
                  title={email}
                  aria-label={`Signed in as ${email}`}
                >
                  {email}
                </p>
              ) : null}
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="min-h-[44px] rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                >
                  Log out
                </button>
              </form>
              <ThemeMenu />
            </div>
          </div>
        </header>
      }
      sideNav={
        <AppSideNav
          pathname={pathname}
          items={navItems}
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
