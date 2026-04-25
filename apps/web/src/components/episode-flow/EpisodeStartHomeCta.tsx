'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { getActiveEpisodeForUser } from '@abstrack/supabase';
import { buildResumeEpisodeHref } from '@/lib/episode-flow/resume-episode-href';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';

export type EpisodeStartHomeCtaProps = {
  /** Extra classes for the outer section (spacing, etc.). */
  className?: string;
};

type CtaMode = 'loading' | 'resume' | 'start';

/**
 * Prominent home entry for episode logging: detects an active episode and offers **Continue this
 * episode** as the primary action; otherwise **I'm having an episode** starts a new flow. CTA mode
 * is conveyed to
 * assistive technologies via a single `aria-live` status region (no duplicate transient announce).
 *
 * @param props - Props.
 * @returns Section with primary CTA for signed-in users.
 */
export function EpisodeStartHomeCta({
  className = '',
}: EpisodeStartHomeCtaProps) {
  const instanceId = useId();
  const headingId = `episode-start-home-cta-heading${instanceId}`;
  const descId = `episode-start-home-cta-desc${instanceId}`;
  const statusId = `episode-start-home-cta-status${instanceId}`;

  const { session, loading: authLoading } = useAuth();

  const [ctaMode, setCtaMode] = useState<CtaMode>('loading');
  const [resumeHref, setResumeHref] = useState<string | null>(null);
  const [resumeToHub, setResumeToHub] = useState(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    const userId = session?.user?.id;
    if (!userId) {
      setCtaMode('start');
      setResumeHref(null);
      setResumeToHub(false);
      return;
    }

    let cancelled = false;
    setCtaMode('loading');
    setResumeHref(null);
    setResumeToHub(false);

    const run = async (): Promise<void> => {
      const supabase = createBrowserClient();
      const result = await getActiveEpisodeForUser(supabase, userId);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setCtaMode('start');
        setResumeHref(null);
        setResumeToHub(false);
        return;
      }
      const row = result.data;
      const presetId = row?.symptom_preset_id ?? null;
      if (row && (row.post_marker_step_completed_at != null || presetId)) {
        const toHub = row.post_marker_step_completed_at != null;
        setResumeHref(
          buildResumeEpisodeHref(row.id, presetId, {
            toHealthMarkers: toHub,
          }),
        );
        setResumeToHub(toHub);
        setCtaMode('resume');
        return;
      }
      setCtaMode('start');
      setResumeHref(null);
      setResumeToHub(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id]);

  const primaryLinkClass =
    'inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 py-4 text-center text-base font-semibold leading-snug text-white shadow-md outline-none ring-2 ring-transparent transition hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:ring-offset-red-950';

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
        {ctaMode === 'loading' && 'Checking for an episode in progress…'}
        {ctaMode === 'resume' &&
          (resumeToHub
            ? 'You have an episode in progress. Continue opens your episode hub: return to the dashboard, log another full check-in, or end the episode when you are done.'
            : 'You have an episode in progress. Continue resumes the guided symptom flow where you left off.')}
        {ctaMode === 'start' &&
          'Opens the guided flow to record what you are experiencing during this episode.'}
      </p>
      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {ctaMode === 'loading' && 'Checking for an in-progress episode.'}
        {ctaMode === 'resume' &&
          (resumeToHub
            ? 'An episode is in progress. Primary action: Continue this episode to the episode hub.'
            : 'An episode is in progress. Primary action: Continue this episode in the guided symptom flow.')}
        {ctaMode === 'start' &&
          'No episode in progress. Primary action: start a new episode.'}
      </p>
      <div className="mt-5">
        {ctaMode === 'loading' && (
          <div
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl border border-app-border/80 bg-app-surface/80 px-5 py-4 text-center text-sm font-medium text-app-muted"
            aria-busy="true"
          >
            Loading…
          </div>
        )}
        {ctaMode === 'resume' && resumeHref !== null && (
          <Link
            href={resumeHref}
            className={primaryLinkClass}
            aria-describedby={`${descId} ${statusId}`}
          >
            Continue this episode
          </Link>
        )}
        {ctaMode === 'start' && (
          <Link
            href="/episode/start"
            className={primaryLinkClass}
            aria-describedby={descId}
          >
            I&apos;m having an episode
          </Link>
        )}
      </div>
    </section>
  );
}
