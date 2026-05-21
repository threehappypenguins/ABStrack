'use client';

import type { ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '../components/sidebar.js';
import { cn } from '../lib/utils.js';
import type { AppSideNavItem, AppSideNavLinkComponent } from './types.js';

/**
 * Sidebar nav link styles (legacy user-web top nav). Uses explicit active/inactive classes
 * because shadcn `data-[active=true]:bg-sidebar-accent` wins in the stylesheet over merged Tailwind.
 *
 * @param active - Whether this item matches the current route.
 * @returns Class string for {@link SidebarMenuButton} (with `isActive` left false).
 */
function sideNavItemClassName(active: boolean): string {
  return cn(
    'min-h-11 w-full !rounded-full px-3 text-base font-medium md:min-h-9 md:text-sm',
    'focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg',
    active
      ? '!bg-app-primary-soft !font-semibold !text-app-primary shadow-sm ring-1 ring-app-primary/25 hover:!bg-app-primary-soft hover:!text-app-primary dark:!bg-app-primary-soft/28 dark:!text-app-ink dark:hover:!bg-app-primary-soft/28 dark:hover:!text-app-ink'
      : '!bg-transparent !text-app-muted hover:!bg-[var(--app-nav-hover-bg)] hover:!text-app-ink',
  );
}

export type AppSideNavProps = {
  /** Current pathname from the host router (e.g. `usePathname()`). */
  pathname: string;
  /** Primary navigation entries. */
  items: AppSideNavItem[];
  /** App link component (e.g. Next.js `Link`). */
  LinkComponent: AppSideNavLinkComponent;
  /** Brand block in the sidebar header (logo, product name). Omit when the app has a top bar brand. */
  brand?: ReactNode;
  /** Optional footer (account actions, theme toggle). */
  footer?: ReactNode;
  /** Accessible name for the navigation landmark. */
  accessibilityLabel?: string;
};

/**
 * Application side navigation built on the shadcn/ui {@link Sidebar} primitives.
 * On narrow viewports the same menu is shown in a slide-over sheet; on `md+` it is a fixed rail.
 *
 * @param props - Side nav configuration.
 * @returns Sidebar panel (desktop) and mobile sheet (via parent {@link SidebarProvider}).
 */
export function AppSideNav({
  pathname,
  items,
  LinkComponent,
  brand,
  footer,
  accessibilityLabel = 'Application',
}: AppSideNavProps) {
  return (
    <Sidebar
      collapsible="offcanvas"
      variant="sidebar"
      className="border-[color:var(--app-header-border)] shadow-sidebar-edge"
    >
      {brand ? (
        <SidebarHeader className="border-b border-[color:var(--app-header-border)] px-3 py-4">
          {brand}
        </SidebarHeader>
      ) : null}
      <SidebarContent className={brand ? undefined : 'pt-3'}>
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">
            Primary navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label={accessibilityLabel}>
              <SidebarMenu>
                {items.map(({ href, label, match }) => {
                  const active = match(pathname);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        asChild
                        isActive={false}
                        tooltip={label}
                        className={sideNavItemClassName(active)}
                      >
                        <LinkComponent
                          href={href}
                          aria-current={active ? 'page' : undefined}
                        >
                          <span>{label}</span>
                        </LinkComponent>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {footer ? (
        <SidebarFooter className="border-t border-[color:var(--app-header-border)] p-3">
          {footer}
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}
