'use client';

import {
  createEpisodeMediaSignedDisplayUrl,
  listEpisodeMediaForEpisode,
  type AbstrackSupabaseClient,
} from '@abstrack/supabase';
import { isMediaType } from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useCallback, useId, useRef, useState } from 'react';

/**
 * Opens or closes a modal `<dialog>` without throwing when already in that state.
 *
 * @param el - Native dialog element.
 * @param open - Whether the dialog should be shown modally.
 */
function setDialogModalOpen(el: HTMLDialogElement, open: boolean): void {
  if (open) {
    if (!el.open) {
      el.showModal();
    }
  } else if (el.open) {
    el.close();
  }
}

function closeDialogIfOpen(el: HTMLDialogElement | null): void {
  if (el?.open) {
    el.close();
  }
}

/** Short-lived signed URL TTL (seconds); matches user apps episode history galleries. */
const EPISODE_MEDIA_SIGNED_URL_TTL_SECONDS = 120;

type PractitionerSymptomMediaViewerProps = {
  supabase: AbstrackSupabaseClient;
  episodeId: string;
  episodeSymptomId: string;
  mediaKind: 'photo' | 'video';
  /** Symptom label for accessible names (e.g. “Rash”). */
  symptomLabel: string;
};

type MediaViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'ready';
      storageKey: string;
      signedUrl: string | null;
      mediaType: 'photo' | 'video';
      loadError: string | null;
    }
  | { phase: 'error'; message: string };

/**
 * Read-only practitioner viewer for one symptom's episode media: lists `episode_media` under RLS,
 * signs via Storage (`episode-media` bucket), renders `<img>` / `<video>`, and refreshes on expiry.
 *
 * @param props - Episode and symptom ids plus media kind from the timeline row.
 * @returns Lazy-load control and signed-URL media preview for a photo or video symptom.
 */
export function PractitionerSymptomMediaViewer({
  supabase,
  episodeId,
  episodeSymptomId,
  mediaKind,
  symptomLabel,
}: PractitionerSymptomMediaViewerProps) {
  const { announce } = useAnnounce();
  const [state, setState] = useState<MediaViewState>({ phase: 'idle' });
  const photoDialogRef = useRef<HTMLDialogElement>(null);
  const photoDialogCloseButtonRef = useRef<HTMLButtonElement>(null);
  const photoDialogTitleId = useId();
  const loadInFlightRef = useRef(false);
  /** Last signed object key + media type; used to refresh without re-listing `episode_media`. */
  const readyStorageRef = useRef<{
    storageKey: string;
    mediaType: 'photo' | 'video';
  } | null>(null);

  const closePhotoModal = useCallback(() => {
    const el = photoDialogRef.current;
    if (el) {
      setDialogModalOpen(el, false);
    }
  }, []);

  const openPhotoModal = useCallback(() => {
    const el = photoDialogRef.current;
    if (el) {
      setDialogModalOpen(el, true);
      queueMicrotask(() => {
        photoDialogCloseButtonRef.current?.focus();
      });
    }
    announce(`Full size photo opened for ${symptomLabel}.`, {
      politeness: 'polite',
    });
  }, [announce, symptomLabel]);

  const signStorageKey = useCallback(
    async (
      rawKey: string,
      mediaType: 'photo' | 'video',
      options?: { announceLoaded?: boolean },
    ): Promise<void> => {
      const storageKey = rawKey.trim();
      const { signedUrl, errorMessage } =
        await createEpisodeMediaSignedDisplayUrl(
          supabase,
          storageKey,
          EPISODE_MEDIA_SIGNED_URL_TTL_SECONDS,
        );
      const signingFailure =
        typeof errorMessage === 'string' ? errorMessage.trim() : '';
      readyStorageRef.current = { storageKey, mediaType };
      setState({
        phase: 'ready',
        storageKey,
        signedUrl,
        mediaType,
        loadError: signedUrl
          ? null
          : signingFailure !== ''
            ? signingFailure
            : 'Could not create media link.',
      });
      if (signedUrl) {
        if (options?.announceLoaded !== false) {
          announce(
            `${mediaType === 'video' ? 'Video' : 'Photo'} loaded for ${symptomLabel}.`,
            { politeness: 'polite' },
          );
        }
        return;
      }
      announce(
        signingFailure !== '' ? signingFailure : 'Could not create media link.',
        { politeness: 'assertive' },
      );
    },
    [announce, supabase, symptomLabel],
  );

  const loadMedia = useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;
    readyStorageRef.current = null;
    setState({ phase: 'loading' });
    try {
      const listed = await listEpisodeMediaForEpisode(supabase, episodeId, {
        episodeSymptomIds: [episodeSymptomId],
      });
      if (!listed.ok) {
        const message = listed.error.message;
        setState({ phase: 'error', message });
        announce(message, { politeness: 'assertive' });
        return;
      }
      const row = listed.data[0];
      if (!row?.storage_object_key?.trim()) {
        const message = 'No media file is available for this symptom.';
        setState({ phase: 'error', message });
        announce(message, { politeness: 'polite' });
        return;
      }
      const mediaType: 'photo' | 'video' = isMediaType(row.media_type)
        ? row.media_type
        : mediaKind;
      await signStorageKey(row.storage_object_key, mediaType);
    } catch {
      const message = 'Unable to load media preview.';
      setState({ phase: 'error', message });
      announce(message, { politeness: 'assertive' });
    } finally {
      loadInFlightRef.current = false;
    }
  }, [
    announce,
    episodeId,
    episodeSymptomId,
    mediaKind,
    signStorageKey,
    supabase,
  ]);

  /**
   * Re-signs {@link MediaViewState} `storageKey` after expiry without re-querying `episode_media`.
   * Falls back to {@link loadMedia} when no key is stored yet.
   */
  const refreshMediaLink = useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    const cached = readyStorageRef.current;
    if (!cached?.storageKey) {
      await loadMedia();
      return;
    }
    loadInFlightRef.current = true;
    setState({ phase: 'loading' });
    try {
      await signStorageKey(cached.storageKey, cached.mediaType, {
        announceLoaded: false,
      });
    } catch {
      const message = 'Unable to load media preview.';
      setState({ phase: 'error', message });
      announce(message, { politeness: 'assertive' });
    } finally {
      loadInFlightRef.current = false;
    }
  }, [announce, loadMedia, signStorageKey]);

  const onDisplayError = useCallback(() => {
    closeDialogIfOpen(photoDialogRef.current);
    setState((prev) => {
      if (prev.phase !== 'ready' || !prev.signedUrl) {
        return prev;
      }
      return {
        ...prev,
        signedUrl: null,
        loadError: 'Link expired or unavailable.',
      };
    });
    announce('Media link expired or unavailable. Refresh to try again.', {
      politeness: 'assertive',
    });
  }, [announce]);

  const viewLabel = mediaKind === 'video' ? 'View video' : 'View photo';
  const regionLabel = `${mediaKind === 'video' ? 'Video' : 'Photo'} for ${symptomLabel}`;

  return (
    <div
      className="mt-2"
      role="region"
      aria-label={regionLabel}
      data-testid="practitioner-symptom-media-viewer"
    >
      {state.phase === 'idle' ? (
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-primary transition hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => void loadMedia()}
        >
          {viewLabel}
        </button>
      ) : null}

      {state.phase === 'loading' ? (
        <p className="text-sm text-app-muted" role="status" aria-live="polite">
          Loading media…
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <div className="space-y-2">
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {state.message}
          </p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={() => void loadMedia()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.phase === 'ready' ? (
        <div className="space-y-2">
          {state.signedUrl ? (
            state.mediaType === 'video' ? (
              <video
                src={state.signedUrl}
                controls
                className="max-h-72 w-full rounded-lg bg-black object-contain"
                onError={onDisplayError}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                  onClick={openPhotoModal}
                  aria-label={`View full size photo for ${symptomLabel}`}
                >
                  <img
                    src={state.signedUrl}
                    alt=""
                    aria-hidden
                    className="max-h-72 w-full rounded-lg bg-black/5 object-contain"
                    onError={onDisplayError}
                  />
                  <span className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-app-primary underline underline-offset-4">
                    View full size
                  </span>
                </button>
                <dialog
                  ref={photoDialogRef}
                  className="m-0 max-h-none max-w-none border-0 bg-transparent p-0 backdrop:bg-black/60"
                  aria-labelledby={photoDialogTitleId}
                  onCancel={(event) => {
                    event.preventDefault();
                    closePhotoModal();
                  }}
                >
                  <div
                    data-testid="photo-modal-scrim"
                    className="fixed inset-0 flex cursor-default items-center justify-center bg-black/60 p-4"
                    onClick={(event) => {
                      if (event.target === event.currentTarget) {
                        closePhotoModal();
                      }
                    }}
                  >
                    <div
                      role="document"
                      className="flex max-h-[95vh] max-w-[min(95vw,64rem)] flex-col gap-4 rounded-2xl border border-app-border/90 bg-app-surface p-4 text-app-ink shadow-xl"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2
                          id={photoDialogTitleId}
                          className="text-lg font-semibold text-app-ink"
                        >
                          {symptomLabel}
                        </h2>
                        <button
                          ref={photoDialogCloseButtonRef}
                          type="button"
                          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-app-border px-4 py-2 text-sm font-semibold text-app-ink transition hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                          onClick={closePhotoModal}
                        >
                          Close
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <img
                          src={state.signedUrl}
                          alt={`${symptomLabel} photo`}
                          className="mx-auto max-h-[calc(95vh-8rem)] w-auto max-w-full object-contain"
                          onError={onDisplayError}
                        />
                      </div>
                    </div>
                  </div>
                </dialog>
              </>
            )
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {state.loadError ?? 'Link expired or unavailable.'}
            </p>
          )}
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={() => void refreshMediaLink()}
          >
            Refresh media link
          </button>
        </div>
      ) : null}
    </div>
  );
}
