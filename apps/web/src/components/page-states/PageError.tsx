'use client';

import { useId } from 'react';

export type PageErrorProps = {
  /** Short heading for the error panel. */
  title: string;
  /** User-facing detail; route `error.tsx` should use `getPublicErrorBoundaryMessage` in production. */
  message: string;
  /** Optional retry action (e.g. Next.js `error.tsx` `reset`). */
  onRetry?: () => void;
};

/**
 * Recoverable error panel for route `error.tsx`; pair with `onRetry={reset}`.
 *
 * @param props - Props.
 * @returns Error section.
 */
export function PageError({ title, message, onRetry }: PageErrorProps) {
  const headingId = useId();

  return (
    <section
      className="rounded-2xl border border-red-300/80 bg-red-50/50 p-6 shadow-soft ring-1 ring-red-900/10 dark:border-red-800/80 dark:bg-red-950/35 dark:ring-red-900/30"
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className="text-lg font-semibold tracking-tight text-red-950 dark:text-red-100"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-red-900/90 dark:text-red-200/95">
        {message}
      </p>
      {onRetry ? (
        <div className="mt-6">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
