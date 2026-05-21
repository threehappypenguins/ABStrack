'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '../components/sidebar.js';
import { cn } from '../lib/utils.js';

export type AppShellWithSideNavProps = {
  children: ReactNode;
  /** Side navigation tree (typically {@link AppSideNav}). */
  sideNav: ReactNode;
  /**
   * Full-width top chrome above the sidebar + main row (e.g. user web top bar).
   * Must render inside {@link SidebarProvider} (e.g. for {@link SidebarTrigger}).
   */
  topHeader?: ReactNode;
  /**
   * Height of {@link topHeader} for desktop sidebar positioning. Sets `--app-shell-header-height`
   * and `--sidebar-top-offset` on {@link SidebarProvider} (defaults to `4.5rem` when `topHeader` is set).
   */
  sidebarTopOffset?: string;
  /** Top chrome inside the main column only (legacy; prefer {@link topHeader}). */
  header?: ReactNode;
  /** Optional skip link rendered before main content. */
  skipLink?: ReactNode;
  /** `id` on the `<main>` landmark (skip-link target); receives `tabIndex={-1}` for focus. */
  mainId?: string;
  /**
   * Layout classes for page content below {@link header} and the built-in mobile menu row
   * (not applied to `<main>` itself, so mobile chrome stays full-width).
   */
  mainClassName?: string;
  /** Accessible label for the mobile menu trigger. */
  mobileMenuTriggerLabel?: string;
  /**
   * Built-in mobile {@link SidebarTrigger} row inside the main column. Defaults to `false` when
   * {@link topHeader} is set (the header should include a trigger); defaults to `true` otherwise,
   * including when only the legacy {@link header} prop is used.
   */
  showMobileMenuTrigger?: boolean;
  /**
   * Cookie for desktop sidebar open state (uncontrolled). Use a distinct name per app on shared
   * hosts (e.g. `abstrack_web_sidebar_state` vs `abstrack_practitioner_sidebar_state`).
   */
  sidebarCookieName?: string;
};

/**
 * Layout shell: optional full-width top header, then side navigation and main column under
 * {@link SidebarProvider}. Exposes a built-in {@link SidebarTrigger} on small screens unless
 * {@link topHeader} supplies one (override with {@link showMobileMenuTrigger}).
 *
 * @param props - Shell layout props.
 * @returns Provider-wrapped page chrome.
 */
export function AppShellWithSideNav({
  children,
  sideNav,
  topHeader,
  sidebarTopOffset = '4.5rem',
  header,
  skipLink,
  mainId = 'main-content',
  mainClassName,
  mobileMenuTriggerLabel = 'Open navigation menu',
  showMobileMenuTrigger,
  sidebarCookieName,
}: AppShellWithSideNavProps) {
  const showMobileTrigger = showMobileMenuTrigger ?? !topHeader;

  const providerStyle: CSSProperties | undefined = topHeader
    ? ({
        '--app-shell-header-height': sidebarTopOffset,
        '--sidebar-top-offset': sidebarTopOffset,
      } as CSSProperties)
    : undefined;

  return (
    <SidebarProvider
      className="flex min-h-svh w-full flex-col"
      style={providerStyle}
      sidebarCookieName={sidebarCookieName}
    >
      {skipLink}
      {topHeader}
      <div className="flex min-h-0 w-full flex-1">
        {sideNav}
        <SidebarInset
          id={mainId}
          tabIndex={-1}
          className="app-grid-background flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {header}
          {showMobileTrigger ? (
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-app-border bg-[var(--app-header-bg)] px-4 shadow-header backdrop-blur-md md:hidden">
              <SidebarTrigger
                className="min-h-11 min-w-11 text-app-ink"
                aria-label={mobileMenuTriggerLabel}
              />
              <span className="text-sm font-semibold text-app-ink">Menu</span>
            </div>
          ) : null}
          <div className={cn('flex min-h-0 flex-1 flex-col', mainClassName)}>
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
