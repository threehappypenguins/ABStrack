import type { ComponentType, ReactNode } from 'react';

/**
 * One primary navigation entry for {@link AppSideNav}.
 */
export type AppSideNavItem = {
  /** Route path (app-specific base path). */
  href: string;
  /** Visible label and accessible name for the link. */
  label: string;
  /** Returns whether `pathname` should mark this item active. */
  match: (pathname: string) => boolean;
};

/**
 * Props passed to the app-supplied link component (e.g. Next.js `Link`).
 */
export type AppSideNavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  'aria-current'?: 'page' | undefined;
};

/**
 * Link component type used by {@link AppSideNav} (`asChild` menu buttons).
 */
export type AppSideNavLinkComponent = ComponentType<AppSideNavLinkProps>;
