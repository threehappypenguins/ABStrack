'use client';

import type { ReactNode } from 'react';

/**
 * Centered loading affordance for Week 4 data-driven pages (used as a route `loading.tsx` fallback
 * or inline while fetching).
 *
 * @param props - Props.
 * @param props.title - Accessible name for the loading region.
 * @returns Loading UI.
 */
export function Week4PageLoading({ title }: { title: string }) {
  return (
    <section
      className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[var(--app-ring-slate)]"
      aria-busy="true"
      aria-label={title}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
          aria-hidden
        />
        <p className="text-sm font-medium text-app-muted">Loading…</p>
      </div>
    </section>
  );
}

export type Week4PageEmptyProps = {
  /** Primary heading inside the card. */
  title: string;
  /** Supporting copy. */
  description: string;
  /** Optional illustration or secondary actions (e.g. future “Create preset”). */
  children?: ReactNode;
};

/**
 * Standard empty state for Week 4 preset lists before CRUD is wired to Supabase.
 *
 * @param props - Props.
 * @returns Empty-state UI.
 */
export function Week4PageEmpty({
  title,
  description,
  children,
}: Week4PageEmptyProps) {
  return (
    <section
      className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[var(--app-ring-slate)]"
      aria-labelledby="week4-empty-heading"
    >
      <h2
        id="week4-empty-heading"
        className="text-lg font-semibold tracking-tight text-app-ink"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-app-muted">
        {description}
      </p>
      {children ? (
        <div className="mt-6 flex flex-wrap gap-3">{children}</div>
      ) : null}
    </section>
  );
}

export type Week4PageErrorProps = {
  /** Short heading for the error panel. */
  title: string;
  /** Error detail (avoid leaking secrets; caller should sanitize if needed). */
  message: string;
  /** Optional retry action (e.g. Next.js `error.tsx` `reset`). */
  onRetry?: () => void;
};

/**
 * Recoverable error panel for Week 4 routes; pair with `error.tsx` and `onRetry={reset}`.
 *
 * @param props - Props.
 * @returns Error UI.
 */
export function Week4PageError({
  title,
  message,
  onRetry,
}: Week4PageErrorProps) {
  return (
    <section
      className="rounded-2xl border border-red-300/80 bg-red-50/50 p-6 shadow-soft ring-1 ring-red-900/10 dark:border-red-800/80 dark:bg-red-950/35 dark:ring-red-900/30"
      aria-labelledby="week4-error-heading"
    >
      <h2
        id="week4-error-heading"
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
