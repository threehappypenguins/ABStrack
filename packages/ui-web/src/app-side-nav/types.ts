import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from 'react';

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
 * Matches anchor semantics so Radix `Slot` / `asChild` can merge `data-*`, handlers, and `ref`
 * from {@link SidebarMenuButton} and tooltip triggers.
 */
export type AppSideNavLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'href'
> & {
  href: string;
  children?: ReactNode;
};

/**
 * Link component type used by {@link AppSideNav} (`asChild` menu buttons). Implement with
 * `forwardRef` and spread remaining props onto the underlying anchor (or Next.js `Link`).
 */
export type AppSideNavLinkComponent = ComponentType<AppSideNavLinkProps>;
