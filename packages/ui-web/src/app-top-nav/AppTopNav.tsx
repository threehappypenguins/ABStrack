'use client';

import { Menu } from 'lucide-react';
import type {
  ComponentPropsWithoutRef,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from 'react';

import { Button } from '../components/button.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/sheet.js';
import { SidebarTrigger } from '../components/sidebar.js';
import { cn } from '../lib/utils.js';
import { ABSTRACK_APP_LOGO_SRC } from './constants.js';

/**
 * Props passed to the app-supplied brand link (e.g. Next.js `Link`).
 * Matches anchor semantics so hosts can forward `aria-*`, `data-*`, and other attributes from
 * {@link AppTopNav}.
 */
export type AppTopNavBrandLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'href'
> & {
  href: string;
  children?: ReactNode;
};

/**
 * Brand link component for {@link AppTopNav}. Must use `forwardRef` and spread remaining props
 * onto the underlying anchor (or Next.js `Link`).
 */
export type AppTopNavBrandLinkComponent = ForwardRefExoticComponent<
  AppTopNavBrandLinkProps & RefAttributes<HTMLAnchorElement>
>;

export type AppTopNavProps = {
  /** Destination for the logo + wordmark (e.g. `/` or `/dashboard`). */
  brandHref: string;
  /** App router link component. */
  brandLinkComponent: AppTopNavBrandLinkComponent;
  /**
   * Secondary line under “ABStrack” (use `ABSTRACK_WEB_TAGLINE` on both web apps).
   * Rendered in small semibold type with wide tracking below the product name.
   */
  tagline: string;
  /** Theme toggle control from the host app (e.g. {@link ThemeMenu}). */
  themeMenu: ReactNode;
  /**
   * Trailing chrome before the theme control: logout, auth cross-links, or marketing placeholders.
   */
  actions?: ReactNode;
  /** Signed-in email; shown on desktop and inside the mobile menu when set. */
  email?: string | null;
  /**
   * When true, renders {@link SidebarTrigger} on narrow viewports (requires a parent
   * {@link SidebarProvider}, e.g. {@link AppShellWithSideNav}).
   */
  showSidebarTrigger?: boolean;
  /**
   * Logo URL under the app `public/` directory. Defaults to {@link ABSTRACK_APP_LOGO_SRC}.
   */
  logoSrc?: string;
  /** Accessible label for the side-navigation trigger (narrow viewports). */
  sidebarTriggerAriaLabel?: string;
  /** Accessible label for the mobile menu trigger. */
  mobileMenuTriggerAriaLabel?: string;
  /** Title for the mobile menu sheet (e.g. “Account” or “Menu”). */
  mobileSheetTitle?: string;
  /** Screen-reader description for the mobile menu sheet. */
  mobileSheetDescription?: string;
};

const ACCOUNT_ACTIONS_SURFACE_CLASS =
  'inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

/**
 * Shared sticky top bar for user and practitioner web apps: brand, optional side-nav trigger,
 * trailing actions, and theme. On viewports below `md`, email, actions, and theme move into a
 * right-hand sheet opened from a menu button.
 *
 * @param props - Top navigation configuration and host-provided slots.
 * @returns Full-width header landmark.
 */
export function AppTopNav({
  brandHref,
  brandLinkComponent: BrandLink,
  tagline,
  themeMenu,
  actions,
  email,
  showSidebarTrigger = false,
  logoSrc = ABSTRACK_APP_LOGO_SRC,
  sidebarTriggerAriaLabel = 'Open navigation menu',
  mobileMenuTriggerAriaLabel = 'Open menu',
  mobileSheetTitle = 'Menu',
  mobileSheetDescription = 'Navigation, account, and appearance settings.',
}: AppTopNavProps) {
  const hasAccountSection = Boolean(email || actions);

  return (
    <header className="sticky top-0 z-50 w-full shrink-0 overflow-visible border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] shadow-header backdrop-blur-md supports-[backdrop-filter]:bg-[var(--app-header-bg)]">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
        {showSidebarTrigger ? (
          <SidebarTrigger
            className="min-h-11 min-w-11 shrink-0 text-app-ink md:hidden"
            aria-label={sidebarTriggerAriaLabel}
          />
        ) : null}
        <BrandLink
          href={brandHref}
          className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg outline-none ring-offset-2 ring-offset-app-bg transition hover:text-app-primary focus-visible:ring-2 focus-visible:ring-app-ring"
          aria-label={`ABStrack ${tagline}`}
        >
          <img
            src={logoSrc}
            alt=""
            width={40}
            height={40}
            className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
          />
          <span className="min-w-0">
            <span className="block text-lg font-bold tracking-tight text-app-ink">
              ABStrack
            </span>
            <span className="mt-0.5 block max-w-[11rem] text-[0.65rem] font-semibold leading-snug tracking-wide text-app-muted sm:max-w-none">
              {tagline}
            </span>
          </span>
        </BrandLink>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <div className="hidden flex-wrap items-center justify-end gap-3 md:flex">
            {email ? (
              <p
                className="max-w-[min(100%,14rem)] truncate text-right text-xs text-app-muted"
                title={email}
                aria-label={`Signed in as ${email}`}
              >
                {email}
              </p>
            ) : null}
            {actions ? (
              <div className={cn('flex flex-wrap items-center gap-3')}>
                {actions}
              </div>
            ) : null}
            {themeMenu}
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  'h-11 w-11 shrink-0 rounded-full border-app-border bg-app-surface text-app-ink shadow-sm hover:bg-[var(--app-nav-hover-bg)] md:hidden',
                )}
                aria-label={mobileMenuTriggerAriaLabel}
              >
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="flex w-[min(100%,20rem)] flex-col gap-6 border-[color:var(--app-header-border)] bg-[var(--app-header-bg)]"
            >
              <SheetHeader>
                <SheetTitle>{mobileSheetTitle}</SheetTitle>
                <SheetDescription className="sr-only">
                  {mobileSheetDescription}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-5 pr-8">
                {email ? (
                  <p
                    className="break-all text-sm text-app-muted"
                    title={email}
                    aria-label={`Signed in as ${email}`}
                  >
                    {email}
                  </p>
                ) : null}
                {actions ? (
                  <div className="flex flex-col gap-3 [&_a]:w-full [&_button]:w-full [&_form]:w-full">
                    {actions}
                  </div>
                ) : null}
                <div
                  className={cn(
                    hasAccountSection
                      ? 'border-t border-[color:var(--app-header-border)] pt-4'
                      : undefined,
                  )}
                >
                  {themeMenu}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

export { ACCOUNT_ACTIONS_SURFACE_CLASS };
