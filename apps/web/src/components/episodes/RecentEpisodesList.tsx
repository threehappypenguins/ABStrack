'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createEpisodeMediaSignedDisplayUrl,
  deleteEpisodeById,
  listEpisodeMediaForEpisode,
} from '@abstrack/supabase';
import {
  formatEpisodeDurationSimple,
  isMediaType,
  type EpisodeRow,
} from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { formatEpisodeTypeSummary } from '@/lib/episodes/format-episode-meta';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import { EpisodeLocaleInstant } from './EpisodeLocaleInstant';

type RecentEpisodesListProps = {
  episodes: EpisodeRow[];
  /**
   * Called after a successful delete instead of {@link useRouter}'s `refresh` (e.g. Manage tab
   * client state).
   */
  onAfterDelete?: () => void;
  /** When true, adds copy that rows are episode records (vs standalone health/food). */
  showEpisodeRecordHint?: boolean;
};

/**
 * Client-side list for ended episodes with explicit destructive delete confirmation.
 *
 * @param props - Ended episode rows and optional refresh hook.
 * @returns Interactive list with per-episode delete action.
 */
export function RecentEpisodesList({
  episodes,
  onAfterDelete,
  showEpisodeRecordHint = false,
}: RecentEpisodesListProps) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [pendingDeleteEpisodeId, setPendingDeleteEpisodeId] = useState<
    string | null
  >(null);
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(
    null,
  );
  const [mediaByEpisodeId, setMediaByEpisodeId] = useState<
    Record<
      string,
      {
        loading: boolean;
        error: string | null;
        items: Array<{
          key: string;
          signedUrl: string | null;
          mediaType: 'video' | 'photo';
          durationSeconds: number | null;
          loadError: string | null;
        }>;
      }
    >
  >({});
  /** Prevents overlapping media loads per episode (e.g. double‑tap before `loading` commits). */
  const episodeMediaLoadInFlightRef = useRef<Record<string, boolean>>({});

  /**
   * Signed URL existed but the asset failed to load (expired, 403, network). Per-item error UI +
   * refresh affordance.
   *
   * @param episodeId - Episode whose media list should be updated.
   * @param storageKey - Episode media storage object key (`item.key`).
   */
  const onEpisodeMediaDisplayError = useCallback(
    (episodeId: string, storageKey: string) => {
      setMediaByEpisodeId((prev) => {
        const state = prev[episodeId];
        if (!state?.items?.length) {
          return prev;
        }
        let changed = false;
        const items = state.items.map((it) => {
          if (it.key !== storageKey || !it.signedUrl) {
            return it;
          }
          changed = true;
          return {
            ...it,
            signedUrl: null,
            loadError: 'Link expired or unavailable.',
          };
        });
        if (!changed) {
          return prev;
        }
        return { ...prev, [episodeId]: { ...state, items } };
      });
    },
    [],
  );

  const pendingEpisode =
    episodes.find((ep) => ep.id === pendingDeleteEpisodeId) ?? null;
  const isDeletingEpisode = deletingEpisodeId !== null;

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
      if (onAfterDelete) {
        onAfterDelete();
      } else {
        router.refresh();
      }
      return;
    } finally {
      setDeletingEpisodeId(null);
    }
  };

  const loadEpisodeMedia = useCallback(async (episodeId: string) => {
    if (episodeMediaLoadInFlightRef.current[episodeId]) {
      return;
    }
    episodeMediaLoadInFlightRef.current[episodeId] = true;
    setMediaByEpisodeId((prev) => ({
      ...prev,
      [episodeId]: {
        loading: true,
        error: null,
        items: prev[episodeId]?.items ?? [],
      },
    }));
    try {
      const supabase = createBrowserClient();
      const listed = await listEpisodeMediaForEpisode(supabase, episodeId);
      if (!listed.ok) {
        setMediaByEpisodeId((prev) => ({
          ...prev,
          [episodeId]: {
            loading: false,
            error: listed.error.message,
            items: [],
          },
        }));
        return;
      }
      // Signing uses `createEpisodeMediaSignedDisplayUrl`: checks Storage `signed.error`, tries
      // normalized legacy key shapes (`storage:`, `episode-media/`, URLs). Per-item `loadError`
      // carries API/auth messages instead of only implying an expired link.
      const items = await Promise.all(
        listed.data.map(async (row) => {
          const rawKey = row.storage_object_key ?? '';
          const { signedUrl, errorMessage } =
            await createEpisodeMediaSignedDisplayUrl(supabase, rawKey, 120);
          const key = rawKey.trim();
          const mediaType: 'video' | 'photo' = isMediaType(row.media_type)
            ? row.media_type
            : 'photo';
          const signingFailure =
            typeof errorMessage === 'string' ? errorMessage.trim() : '';
          return {
            key,
            signedUrl,
            mediaType,
            durationSeconds: row.duration_seconds,
            loadError: signedUrl
              ? null
              : signingFailure !== ''
                ? signingFailure
                : 'Could not create media link.',
          };
        }),
      );
      setMediaByEpisodeId((prev) => ({
        ...prev,
        [episodeId]: { loading: false, error: null, items },
      }));
    } catch {
      setMediaByEpisodeId((prev) => ({
        ...prev,
        [episodeId]: {
          loading: false,
          error: 'Unable to load media preview.',
          items: [],
        },
      }));
    } finally {
      episodeMediaLoadInFlightRef.current[episodeId] = false;
    }
  }, []);

  return (
    <>
      <ul className="mt-3 space-y-3" role="list">
        {episodes.map((ep) => (
          <li key={ep.id}>
            <div className="rounded-xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                Ended
              </p>
              {showEpisodeRecordHint ? (
                <p className="mt-0.5 text-xs text-app-muted">
                  Episode record (not a standalone diary entry)
                </p>
              ) : null}
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
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-app-ink/80">Duration</dt>
                  <dd>
                    {formatEpisodeDurationSimple(ep.started_at, ep.ended_at) ??
                      '—'}
                  </dd>
                </div>
              </dl>
              <details className="mt-3 rounded-lg border border-app-border/80 bg-app-bg/40 p-3 text-sm text-app-muted dark:border-app-border-dark/80 dark:bg-app-surface-dark/40">
                <summary className="cursor-pointer text-sm font-semibold text-app-primary outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg">
                  View details
                </summary>
                <div className="mt-2 space-y-1 text-xs">
                  <p>
                    <span className="font-medium text-app-ink/90">Type:</span>{' '}
                    {ep.episode_type}
                  </p>
                  {ep.episode_label?.trim() ? (
                    <p>
                      <span className="font-medium text-app-ink/90">
                        Label:
                      </span>{' '}
                      {ep.episode_label.trim()}
                    </p>
                  ) : null}
                </div>
                <div
                  className="mt-3"
                  aria-busy={mediaByEpisodeId[ep.id]?.loading === true}
                >
                  {(() => {
                    const mediaState = mediaByEpisodeId[ep.id];
                    return (
                      <>
                        <p className="text-xs font-semibold text-app-ink/90">
                          Media
                        </p>
                        {!mediaState ? (
                          <button
                            type="button"
                            className="mt-2 inline-flex min-h-[40px] items-center rounded-lg border border-app-border px-3 py-2 text-xs font-semibold text-app-primary"
                            onClick={() => void loadEpisodeMedia(ep.id)}
                          >
                            Load media
                          </button>
                        ) : null}
                        {mediaState?.loading ? (
                          <p className="mt-2 text-xs text-app-muted">
                            Loading media…
                          </p>
                        ) : null}
                        {mediaState?.error ? (
                          <div className="mt-2">
                            <p className="text-xs text-red-700 dark:text-red-300">
                              {mediaState.error}
                            </p>
                            <button
                              type="button"
                              className={`mt-2 inline-flex min-h-[36px] items-center rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-primary ${mediaState?.loading ? 'cursor-not-allowed opacity-50' : ''}`}
                              onClick={() => void loadEpisodeMedia(ep.id)}
                              disabled={Boolean(mediaState?.loading)}
                            >
                              Retry
                            </button>
                          </div>
                        ) : null}
                        {!mediaState?.loading &&
                        !mediaState?.error &&
                        mediaState &&
                        mediaState.items.length === 0 ? (
                          <p className="mt-2 text-xs text-app-muted">
                            No photo or video for this episode.
                          </p>
                        ) : null}
                        {mediaState?.items.length ? (
                          <div className="mt-2 space-y-2">
                            {mediaState.items.map((item) => (
                              <div
                                key={item.key}
                                className="rounded border border-app-border/70 p-2"
                              >
                                {item.signedUrl ? (
                                  item.mediaType === 'video' ? (
                                    <video
                                      src={item.signedUrl}
                                      controls
                                      className="max-h-56 w-full rounded bg-black object-contain"
                                      onError={() =>
                                        onEpisodeMediaDisplayError(
                                          ep.id,
                                          item.key,
                                        )
                                      }
                                    />
                                  ) : (
                                    <img
                                      src={item.signedUrl}
                                      alt="Episode media"
                                      className="max-h-56 w-full rounded bg-black/5 object-contain"
                                      onError={() =>
                                        onEpisodeMediaDisplayError(
                                          ep.id,
                                          item.key,
                                        )
                                      }
                                    />
                                  )
                                ) : (
                                  <p className="text-xs text-red-700 dark:text-red-300">
                                    {item.loadError ??
                                      'Link expired or unavailable.'}
                                  </p>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              className={`inline-flex min-h-[36px] items-center rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-primary ${mediaState?.loading ? 'cursor-not-allowed opacity-50' : ''}`}
                              onClick={() => void loadEpisodeMedia(ep.id)}
                              disabled={Boolean(mediaState?.loading)}
                            >
                              Refresh media links
                            </button>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </details>
              <button
                type="button"
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
                onClick={() => {
                  if (isDeletingEpisode) {
                    return;
                  }
                  setPendingDeleteEpisodeId(ep.id);
                }}
                disabled={isDeletingEpisode}
              >
                {deletingEpisodeId === ep.id
                  ? 'Deleting episode…'
                  : 'Delete episode'}
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
