import type { ReactNode } from 'react';

export type PageEmptyProps = {
  /** Primary heading inside the card. */
  title: string;
  /** Supporting copy. */
  description: string;
  /** Optional secondary actions or illustration. */
  children?: ReactNode;
};

/**
 * Standard empty state for list pages before data exists or CRUD is wired.
 * Server Component: unique heading id per render via `crypto.randomUUID()` (no `'use client'`).
 *
 * @param props - Props.
 * @returns Empty-state section.
 */
export function PageEmpty({ title, description, children }: PageEmptyProps) {
  const headingId = crypto.randomUUID();

  return (
    <section
      className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
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
