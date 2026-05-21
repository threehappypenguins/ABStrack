'use client';

import { useId, type ReactNode } from 'react';

import { cn } from '../lib/utils.js';

export type AppNotFoundPanelProps = {
  /** Optional recovery control (e.g. a Next.js `Link` to dashboard or patients). */
  homeLink?: ReactNode;
  /** Extra layout classes on the panel root. */
  className?: string;
  /**
   * Override the heading element id for `aria-labelledby`. Defaults to a stable unique id from
   * {@link useId} so multiple panels on one page do not collide.
   */
  headingId?: string;
};

/**
 * Themed 404 content for Next.js `not-found` boundaries. Avoids the framework default
 * fallback that sets `body` background from `prefers-color-scheme` instead of `html.dark`.
 *
 * @param props - Copy and optional recovery link.
 * @returns Centered not-found section using app semantic colors.
 */
export function AppNotFoundPanel({
  homeLink,
  className,
  headingId: headingIdProp,
}: AppNotFoundPanelProps) {
  const generatedHeadingId = useId();
  const headingId = headingIdProp ?? generatedHeadingId;

  return (
    <section
      className={cn(
        'flex flex-1 flex-col items-center justify-center px-4 py-16 text-center',
        className,
      )}
      aria-labelledby={headingId}
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-app-muted">
        404
      </p>
      <h1
        id={headingId}
        className="mt-2 text-2xl font-bold tracking-tight text-app-ink sm:text-3xl"
      >
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-app-muted">
        This page does not exist or may have moved. Check the address and try
        again.
      </p>
      {homeLink ? <div className="mt-8">{homeLink}</div> : null}
    </section>
  );
}
