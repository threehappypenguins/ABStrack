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
  /** Classes on the `<main>` landmark (`SidebarInset`). */
  mainClassName?: string;
  /** Accessible label for the mobile menu trigger. */
  mobileMenuTriggerLabel?: string;
};

/**
 * Layout shell: optional full-width top header, then side navigation and main column under
 * {@link SidebarProvider}. Exposes {@link SidebarTrigger} on small screens when no header is passed.
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
}: AppShellWithSideNavProps) {
  const showMobileTrigger = !header && !topHeader;

  const providerStyle: CSSProperties = {
    '--sidebar-width': '16rem',
    '--sidebar-width-mobile': '18rem',
    ...(topHeader
      ? {
          '--app-shell-header-height': sidebarTopOffset,
          '--sidebar-top-offset': sidebarTopOffset,
        }
      : {}),
  } as CSSProperties;

  return (
    <SidebarProvider
      className="flex min-h-svh w-full flex-col"
      style={providerStyle}
    >
      {skipLink}
      {topHeader}
      <div className="flex min-h-0 w-full flex-1">
        {sideNav}
        <SidebarInset
          id={mainId}
          tabIndex={-1}
          className={cn(
            'app-grid-background flex min-h-0 min-w-0 flex-1 flex-col',
            mainClassName,
          )}
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
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
