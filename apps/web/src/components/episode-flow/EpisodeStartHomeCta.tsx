'use client';

import Link from 'next/link';
import { useId } from 'react';

export type EpisodeStartHomeCtaProps = {
  /** Extra classes for the outer section (spacing, etc.). */
  className?: string;
};

/**
 * Prominent home entry point for the episode logging flow: large target, high-contrast primary
 * control, and supporting copy for keyboard and touch users. Uses {@link useId} so multiple
 * instances on one page do not duplicate DOM ids or break ARIA references.
 *
 * @param props - Props.
 * @returns Section with link to the episode-start shell route.
 */
export function EpisodeStartHomeCta({
  className = '',
}: EpisodeStartHomeCtaProps) {
  const instanceId = useId();
  const headingId = `episode-start-home-cta-heading${instanceId}`;
  const descId = `episode-start-home-cta-desc${instanceId}`;

  return (
    <section
      className={`rounded-2xl border-2 border-red-600/35 bg-red-50 p-5 shadow-sm ring-1 ring-red-900/10 dark:border-red-500/40 dark:bg-red-950/45 dark:ring-red-950/40 sm:p-6 ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className="text-lg font-semibold tracking-tight text-app-ink"
      >
        Episode logging
      </h2>
      <p id={descId} className="mt-1.5 text-sm leading-relaxed text-app-muted">
        Opens the guided flow to record what you are experiencing during this
        episode.
      </p>
      <div className="mt-5">
        <Link
          href="/episode/start"
          className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 py-4 text-center text-base font-semibold leading-snug text-white shadow-md outline-none ring-2 ring-transparent transition hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:ring-offset-red-950"
          aria-describedby={descId}
        >
          I&apos;m having an episode
        </Link>
      </div>
    </section>
  );
}
