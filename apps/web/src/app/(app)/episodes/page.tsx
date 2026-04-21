import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { EpisodeRow } from '@abstrack/types';
import {
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import { ActiveEpisodeCard } from '@/components/episodes/ActiveEpisodeCard';
import { RecentEpisodesList } from '@/components/episodes/RecentEpisodesList';
import { createServerClient } from '@/lib/supabase/server-client';

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
          <ActiveEpisodeCard episode={active} />
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
          <RecentEpisodesList episodes={recent} />
        ) : null}
      </section>
    </div>
  );
}
