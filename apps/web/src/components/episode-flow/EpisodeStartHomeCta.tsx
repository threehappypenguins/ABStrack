'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { getActiveEpisodeForUser } from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';

export type EpisodeStartHomeCtaProps = {
  /** Extra classes for the outer section (spacing, etc.). */
  className?: string;
};

type CtaMode = 'loading' | 'resume' | 'start';

/**
 * Builds the symptom flow URL with resume placement so the stepper opens at the correct line.
 *
 * @param episodeId - `episodes.id`.
 * @param symptomPresetId - `symptom_presets.id` on the episode row.
 * @returns Path under `/episode/[id]/symptoms`.
 */
function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string,
): string {
  const q = new URLSearchParams();
  q.set('symptomPresetId', symptomPresetId);
  q.set('resume', '1');
  return `/episode/${episodeId}/symptoms?${q.toString()}`;
}

/**
 * Prominent home entry for episode logging: detects an active episode and offers **Resume** as the
 * primary action; otherwise **I'm having an episode** starts a new flow. Announces mode changes for
 * assistive tech.
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
  const { announce } = useAnnounce();
  const announcedFromLoadingRef = useRef(false);

  const [ctaMode, setCtaMode] = useState<CtaMode>('loading');
  const [resumeHref, setResumeHref] = useState<string | null>(null);

  useEffect(() => {
    announcedFromLoadingRef.current = false;
  }, [session?.user?.id]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    const userId = session?.user?.id;
    if (!userId) {
      setCtaMode('start');
      setResumeHref(null);
      return;
    }

    let cancelled = false;
    setCtaMode('loading');
    setResumeHref(null);

    const run = async (): Promise<void> => {
      const supabase = createBrowserClient();
      const result = await getActiveEpisodeForUser(supabase, userId);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setCtaMode('start');
        setResumeHref(null);
        return;
      }
      const row = result.data;
      const presetId = row?.symptom_preset_id ?? null;
      if (row && presetId) {
        setResumeHref(buildResumeEpisodeHref(row.id, presetId));
        setCtaMode('resume');
        return;
      }
      setCtaMode('start');
      setResumeHref(null);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id]);

  useEffect(() => {
    if (ctaMode === 'loading' || authLoading) {
      return;
    }
    if (!announcedFromLoadingRef.current) {
      announcedFromLoadingRef.current = true;
      if (ctaMode === 'resume') {
        announce(
          'You have an episode in progress. Resume episode is available as the primary action.',
          { politeness: 'polite' },
        );
      } else {
        announce(
          'No episode in progress. You can start logging a new episode.',
          { politeness: 'polite' },
        );
      }
    }
  }, [announce, authLoading, ctaMode]);

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
          'You have an episode in progress. Continue where you left off in the guided symptom flow.'}
        {ctaMode === 'start' &&
          'Opens the guided flow to record what you are experiencing during this episode.'}
      </p>
      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {ctaMode === 'loading' && 'Checking for an in-progress episode.'}
        {ctaMode === 'resume' &&
          'An episode is in progress. Primary action: Resume episode.'}
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
            Resume episode
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
