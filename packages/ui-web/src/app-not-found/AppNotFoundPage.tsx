import type { ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import {
  AppNotFoundPanel,
  type AppNotFoundPanelProps,
} from './AppNotFoundPanel.js';

export type AppNotFoundPageProps = AppNotFoundPanelProps & {
  /**
   * Optional top navigation when the app root layout does not already render chrome
   * (most apps mount public/authenticated nav in the root layout and pass only panel props).
   */
  topNav?: ReactNode;
};

const DEFAULT_PANEL_CLASS = 'min-h-[min(100%,calc(100svh-4.5rem))]';

/**
 * Shared 404 page content for Next.js `not-found` boundaries. Renders {@link AppNotFoundPanel}
 * inside the app grid main when `topNav` is provided; otherwise returns the panel alone for use
 * inside an existing shell `<main>`.
 *
 * @param props - Optional top nav, recovery link, and layout classes.
 * @returns Not-found section (and optional nav + main landmark).
 */
export function AppNotFoundPage({
  topNav,
  className,
  homeLink,
}: AppNotFoundPageProps) {
  const panel = (
    <AppNotFoundPanel
      homeLink={homeLink}
      className={cn(DEFAULT_PANEL_CLASS, className)}
    />
  );

  if (!topNav) {
    return panel;
  }

  return (
    <>
      {topNav}
      <main
        id="main-content"
        className="app-grid-background flex min-h-svh min-w-0 flex-col"
      >
        {panel}
      </main>
    </>
  );
}
