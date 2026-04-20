import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { EpisodeRow } from '@abstrack/types';
import {
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import {
  formatEpisodeInstant,
  formatEpisodeTypeSummary,
} from '@/lib/episodes/format-episode-meta';
import { buildResumeEpisodeHref } from '@/lib/episode-flow/resume-episode-href';
import { createServerClient } from '@/lib/supabase/server-client';

const resumeLinkClass =
  'inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm outline-none ring-2 ring-transparent transition hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-50 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:focus-visible:ring-offset-emerald-950';

/**
 * Lists active and recently ended episodes with metadata; resume navigates into the symptom
 * flow when a symptom preset is present.
 *
 * @returns Episodes management page.
 */
export default async function EpisodesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  const allowDevAuthErrorDebugView =
    process.env.NODE_ENV !== 'production' && !!getUserError;

  if (getUserError) {
    console.error('Failed to fetch user for episodes page', getUserError);
  }

  if (!user && !allowDevAuthErrorDebugView) {
    redirect('/login');
  }

  let activeError: string | null = null;
  let recentError: string | null = null;
  let active: EpisodeRow | null = null;
  let recent: EpisodeRow[] = [];

  if (user) {
    const [activeRes, recentRes] = await Promise.all([
      getActiveEpisodeForUser(supabase, user.id),
      listCompletedEpisodesForUser(supabase, user.id, { limit: 25 }),
    ]);
    if (!activeRes.ok) {
      activeError = activeRes.error.message;
    } else {
      active = activeRes.data;
    }
    if (!recentRes.ok) {
      recentError = recentRes.error.message;
    } else {
      recent = recentRes.data;
    }
  }

  return (
    <div className="w-full space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episodes
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Review your active episode and recent history. Resume continues the
          guided symptom flow.
        </p>
      </div>

      <section aria-labelledby="episodes-active-heading">
        <h2
          id="episodes-active-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Active episode
        </h2>
        {activeError ? (
          <p
            className="mt-2 text-sm text-red-700 dark:text-red-300"
            role="alert"
          >
            {activeError}
          </p>
        ) : null}
        {!user && allowDevAuthErrorDebugView ? (
          <p className="mt-3 text-sm text-app-muted">
            Sign in to load episodes (development: no session).
          </p>
        ) : null}
        {user && !activeError && active === null ? (
          <p className="mt-3 rounded-xl border border-dashed border-app-border/90 bg-app-surface/60 p-4 text-sm text-app-muted">
            No episode in progress.{' '}
            <Link
              href="/episode/start"
              className="font-semibold text-app-primary underline underline-offset-2"
            >
              Start an episode
            </Link>{' '}
            from the guided flow when you need to log symptoms.
          </p>
        ) : null}
        {user && !activeError && active !== null ? (
          <div
            className="mt-3 rounded-2xl border-2 border-emerald-600/45 bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-900/10 dark:border-emerald-500/45 dark:bg-emerald-950/40 dark:ring-emerald-950/35 sm:p-6"
            aria-label="Active episode"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
              In progress
            </p>
            <p className="mt-2 text-base font-semibold text-app-ink">
              {formatEpisodeTypeSummary(active)}
            </p>
            <dl className="mt-3 space-y-1.5 text-sm text-app-muted">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-app-ink/80">Started</dt>
                <dd>{formatEpisodeInstant(active.started_at)}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-app-ink/80">Ended</dt>
                <dd>—</dd>
              </div>
            </dl>
            <div className="mt-5">
              {active.symptom_preset_id ? (
                <Link
                  href={buildResumeEpisodeHref(
                    active.id,
                    active.symptom_preset_id,
                  )}
                  className={resumeLinkClass}
                >
                  Resume this episode
                </Link>
              ) : (
                <p className="text-sm text-app-muted">
                  This episode has no symptom preset linked yet.{' '}
                  <Link
                    href="/episode/start"
                    className="font-semibold text-app-primary underline underline-offset-2"
                  >
                    Open episode start
                  </Link>{' '}
                  to continue setup.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="episodes-recent-heading">
        <h2
          id="episodes-recent-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Recent episodes
        </h2>
        {recentError ? (
          <p
            className="mt-2 text-sm text-red-700 dark:text-red-300"
            role="alert"
          >
            {recentError}
          </p>
        ) : null}
        {user && !recentError && recent.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">
            No ended episodes in your history yet. When you end an episode, it
            appears here.
          </p>
        ) : null}
        {user && !recentError && recent.length > 0 ? (
          <ul className="mt-3 space-y-3" role="list">
            {recent.map((ep) => (
              <li key={ep.id}>
                <div className="rounded-xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                    Ended
                  </p>
                  <p className="mt-1.5 text-base font-semibold text-app-ink">
                    {formatEpisodeTypeSummary(ep)}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm text-app-muted">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-app-ink/80">Started</dt>
                      <dd>{formatEpisodeInstant(ep.started_at)}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-app-ink/80">Ended</dt>
                      <dd>
                        {ep.ended_at ? formatEpisodeInstant(ep.ended_at) : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
