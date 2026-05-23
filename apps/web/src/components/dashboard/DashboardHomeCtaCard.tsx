'use client';

import Link from 'next/link';
import { useId } from 'react';

export type DashboardHomeCtaCardProps = {
  /** Visible section heading. */
  heading: string;
  /** Short explanatory copy under the heading. */
  description: string;
  /** Primary action destination. */
  href: string;
  /** Primary link label. */
  ctaLabel: string;
  /** Extra classes on the outer section (spacing, etc.). */
  className?: string;
};

const cardShellClass =
  'rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-6';

const primaryLinkClass =
  'inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-app-primary-solid px-5 py-4 text-center text-base font-semibold leading-snug text-app-on-primary-solid shadow-md outline-none ring-2 ring-transparent transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

/**
 * Neutral-themed home dashboard card for logging flows (health markers, food diary, etc.).
 * Episode logging uses {@link EpisodeStartHomeCta} with distinct urgent styling.
 *
 * @param props - Card copy and CTA target.
 * @returns Section with heading, description, and primary link.
 */
export function DashboardHomeCtaCard({
  heading,
  description,
  href,
  ctaLabel,
  className = '',
}: DashboardHomeCtaCardProps) {
  const instanceId = useId();
  const headingId = `dashboard-cta-heading-${instanceId}`;

  return (
    <section
      className={`${cardShellClass} ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className="text-lg font-semibold tracking-tight text-app-ink"
      >
        {heading}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-app-muted">
        {description}
      </p>
      <div className="mt-5">
        <Link href={href} className={primaryLinkClass}>
          {ctaLabel}
        </Link>
      </div>
    </section>
  );
}
