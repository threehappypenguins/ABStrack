'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteEpisodeById } from '@abstrack/supabase';
import type { EpisodeRow } from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { formatEpisodeTypeSummary } from '@/lib/episodes/format-episode-meta';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import { EpisodeLocaleInstant } from './EpisodeLocaleInstant';

type RecentEpisodesListProps = {
  episodes: EpisodeRow[];
};

/**
 * Client-side list for ended episodes with explicit destructive delete confirmation.
 *
 * @param props - Ended episode rows shown on the Episodes page.
 * @returns Interactive list with per-episode delete action.
 */
export function RecentEpisodesList({ episodes }: RecentEpisodesListProps) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [pendingDeleteEpisodeId, setPendingDeleteEpisodeId] = useState<
    string | null
  >(null);
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(
    null,
  );

  const pendingEpisode =
    episodes.find((ep) => ep.id === pendingDeleteEpisodeId) ?? null;

  const handleConfirmDelete = async (): Promise<void | false> => {
    if (!pendingEpisode || deletingEpisodeId) {
      return false;
    }
    setDeletingEpisodeId(pendingEpisode.id);
    try {
      const supabase = createBrowserClient();
      const result = await deleteEpisodeById(supabase, pendingEpisode.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      if (result.data.didDelete) {
        announce('Episode deleted from history.', { politeness: 'polite' });
      } else {
        announce('This episode is no longer available.', {
          politeness: 'polite',
        });
      }
      router.refresh();
      return;
    } finally {
      setDeletingEpisodeId(null);
    }
  };

  return (
    <>
      <ul className="mt-3 space-y-3" role="list">
        {episodes.map((ep) => (
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
                  <dd>
                    <EpisodeLocaleInstant iso={ep.started_at} />
                  </dd>
                </div>
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
              </dl>
              <button
                type="button"
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
                onClick={() => {
                  setPendingDeleteEpisodeId(ep.id);
                }}
                disabled={deletingEpisodeId === ep.id}
              >
                Delete episode
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingEpisode !== null}
        title="Delete this episode from history?"
        description="Deleting permanently removes this episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
        confirmLabel="Delete episode"
        confirmBusyLabel="Deleting episode…"
        cancelLabel="Keep episode"
        onConfirm={handleConfirmDelete}
        onClose={() => {
          setPendingDeleteEpisodeId(null);
        }}
      />
    </>
  );
}
