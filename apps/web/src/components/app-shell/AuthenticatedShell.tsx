'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { NavigationShell } from '@abstrack/ui';

import { useWebPhiSubjectUserContext } from '@/lib/patient/use-web-phi-subject-user-context';

const NAV_ITEMS: {
  href: string;
  label: string;
  match: (path: string) => boolean;
}[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    match: (path) => path === '/dashboard' || path.startsWith('/dashboard/'),
  },
  {
    href: '/manage',
    label: 'Manage',
    match: (path) => path === '/manage' || path.startsWith('/manage/'),
  },
  {
    href: '/presets/symptoms',
    label: 'Symptom presets',
    match: (path) =>
      path === '/presets/symptoms' || path.startsWith('/presets/symptoms/'),
  },
  {
    href: '/presets/health-markers',
    label: 'Health marker presets',
    match: (path) =>
      path === '/presets/health-markers' ||
      path.startsWith('/presets/health-markers/'),
  },
  {
    href: '/presets/episode-templates',
    label: 'Episode templates',
    match: (path) =>
      path === '/presets/episode-templates' ||
      path.startsWith('/presets/episode-templates/'),
  },
  {
    href: '/settings/caretaker',
    label: 'Caretaker',
    match: (path) =>
      path === '/settings' ||
      path === '/settings/caretaker' ||
      path.startsWith('/settings/'),
  },
];

function isNavActive(pathname: string, match: (path: string) => boolean) {
  return match(pathname);
}

export type AuthenticatedShellProps = {
  children: ReactNode;
  /** Signed-in email when available; omitted in rare dev-only auth-error views. */
  email?: string | null;
};

/**
 * Authenticated app chrome: skip link, {@link NavigationShell} with primary nav, sign-out, and a
 * centered main column. Surfaces use CSS variables so light/dark tracks the theme toggle.
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
    if (profileAppRole === 'caretaker') {
      return NAV_ITEMS.filter((item) => item.href !== '/settings/caretaker');
    }
    return NAV_ITEMS;
  }, [profileAppRole]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-app-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-app-ink focus:shadow-soft focus:outline-none focus:ring-2 focus:ring-app-ring focus:ring-offset-2 focus:ring-offset-app-bg"
      >
        Skip to main content
      </a>
      <NavigationShell
        accessibilityLabel="ABStrack application"
        style={{ backgroundColor: 'transparent' }}
        headerStyle={{
          backgroundColor: 'transparent',
          borderBottomWidth: 0,
          paddingHorizontal: 0,
          paddingVertical: 0,
        }}
        mainStyle={{ backgroundColor: 'transparent', flex: 1 }}
        header={
          <header className="sticky top-0 z-40 border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] shadow-header backdrop-blur-md supports-[backdrop-filter]:bg-[var(--app-header-bg)]">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-8">
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

              <nav
                aria-label="Primary"
                className="flex flex-1 flex-wrap items-center justify-center gap-1.5 sm:justify-start lg:justify-center"
              >
                {navItems.map(({ href, label, match }) => {
                  const active = isNavActive(pathname, match);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={
                        active
                          ? 'inline-flex min-h-[44px] items-center rounded-full bg-app-primary-soft px-4 py-2 text-sm font-semibold text-app-primary shadow-sm ring-1 ring-app-primary/25 transition outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-app-primary-soft/28'
                          : 'inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-sm font-medium text-app-muted transition outline-none hover:bg-[var(--app-nav-hover-bg)] hover:text-app-ink focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
                      }
                    >
                      {label}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-app-border/60 pt-3 sm:border-t-0 sm:pt-0 lg:shrink-0">
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
              </div>
            </div>
          </header>
        }
      >
        <main
          id="main-content"
          className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </NavigationShell>
    </div>
  );
}
