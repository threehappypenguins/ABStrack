import type { ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import {
  AppNotFoundPanel,
  type AppNotFoundPanelProps,
} from './AppNotFoundPanel.js';

export type AppNotFoundPageProps = AppNotFoundPanelProps & {
  /** Optional top navigation when the app root layout does not already render chrome. */
  topNav?: ReactNode;
  /**
   * When true (default), wraps the panel in `<main id="main-content">` with the app grid
   * background. Set false when a parent layout or shell already supplies the main landmark.
   */
  wrapInMain?: boolean;
};

const DEFAULT_PANEL_CLASS = 'min-h-[min(100%,calc(100svh-4.5rem))]';

const MAIN_CLASS =
  'app-grid-background flex min-h-[calc(100svh-4.5rem)] min-w-0 flex-col';

/**
 * Shared 404 page content for Next.js `not-found` boundaries. Renders {@link AppNotFoundPanel}
 * and optionally a `<main>` landmark and top nav slot.
 *
 * @param props - Optional top nav, main wrapper, recovery link, and layout classes.
 * @returns Not-found section (and optional nav + main landmark).
 */
export function AppNotFoundPage({
  topNav,
  wrapInMain = true,
  className,
  homeLink,
}: AppNotFoundPageProps) {
  const panel = (
    <AppNotFoundPanel
      homeLink={homeLink}
      className={cn(DEFAULT_PANEL_CLASS, className)}
    />
  );

  const content = wrapInMain ? (
    <main id="main-content" className={MAIN_CLASS}>
      {panel}
    </main>
  ) : (
    panel
  );

  if (topNav) {
    return (
      <>
        {topNav}
        {content}
      </>
    );
  }

  return content;
}
