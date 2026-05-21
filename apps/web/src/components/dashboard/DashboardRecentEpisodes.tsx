'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { listCompletedEpisodesForUser } from '@abstrack/supabase';
import { formatEpisodeDurationSimple, type EpisodeRow } from '@abstrack/types';
import { EpisodeLocaleInstant } from '@/components/episodes/EpisodeLocaleInstant';
import { formatEpisodeTypeSummary } from '@/lib/episodes/format-episode-meta';
import { useWebPhiSubjectUserContext } from '@/lib/patient/use-web-phi-subject-user-context';
import { createBrowserClient } from '@/lib/supabase/browser-client';

/** Number of ended episodes shown on the home dashboard. */
const DASHBOARD_RECENT_EPISODES_LIMIT = 3;

const cardShellClass =
  'rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-6';

export type DashboardRecentEpisodesProps = {
  /** Extra classes on the outer section. */
  className?: string;
};

/**
 * Home dashboard preview of the patient's most recently ended episodes.
 *
 * @param props - Optional layout classes.
 * @returns Card with a short list and link to full episode history.
 */
export function DashboardRecentEpisodes({
  className = '',
}: DashboardRecentEpisodesProps) {
  const instanceId = useId();
  const headingId = `dashboard-recent-episodes-heading${instanceId}`;

  const {
    phiSubjectUserId,
    loading: phiLoading,
    errorMessage: phiError,
  } = useWebPhiSubjectUserContext();

  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phiLoading) {
      return;
    }
    if (phiError) {
      setEpisodes([]);
      setError(phiError);
      setLoading(false);
      return;
    }
    if (!phiSubjectUserId) {
      setEpisodes([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async (): Promise<void> => {
      try {
        const supabase = createBrowserClient();
        const result = await listCompletedEpisodesForUser(
          supabase,
          phiSubjectUserId,
          { limit: DASHBOARD_RECENT_EPISODES_LIMIT, offset: 0 },
        );
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setEpisodes([]);
          setError(result.error.message);
          return;
        }
        setEpisodes(result.data);
        setError(null);
      } catch {
        if (!cancelled) {
          setEpisodes([]);
          setError('Unable to load recent episodes.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [phiError, phiLoading, phiSubjectUserId]);

  return (
    <section
      className={`${cardShellClass} ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className="text-lg font-semibold tracking-tight text-app-ink"
      >
        Recent episodes
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-app-muted">
        Your latest ended episodes. Open Manage for the full history, filters,
        and delete actions.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-app-muted" aria-busy="true">
          Loading recent episodes…
        </p>
      ) : null}

      {!loading && error ? (
        <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && episodes.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-app-border/90 bg-app-bg/40 p-4 text-sm text-app-muted">
          No ended episodes yet.{' '}
          <Link
            href="/episode/start"
            className="font-semibold text-app-primary underline underline-offset-2"
          >
            Start an episode
          </Link>{' '}
          when you are ready to log symptoms.
        </p>
      ) : null}

      {!loading && !error && episodes.length > 0 ? (
        <>
          <ul className="mt-4 space-y-3" role="list">
            {episodes.map((ep) => (
              <li key={ep.id}>
                <div className="rounded-xl border border-app-border/90 bg-app-bg/40 p-4 ring-1 ring-[color:var(--app-ring-slate)] dark:bg-app-surface-dark/40">
                  <p className="text-base font-semibold text-app-ink">
                    {formatEpisodeTypeSummary(ep)}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm text-app-muted">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-app-ink/80">Ended</dt>
                      <dd>
                        {ep.ended_at ? (
                          <EpisodeLocaleInstant iso={ep.ended_at} />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-app-ink/80">Duration</dt>
                      <dd>
                        {formatEpisodeDurationSimple(
                          ep.started_at,
                          ep.ended_at,
                        ) ?? '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
          <Link
            href="/manage?segment=episodes"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-app-border-dark dark:bg-app-surface-dark"
          >
            View all episodes
          </Link>
        </>
      ) : null}
    </section>
  );
}
