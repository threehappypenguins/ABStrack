'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  EpisodeSymptomRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomPromptPhotoCaptureRef,
  SymptomPromptAnswers,
  SymptomPromptVideoCaptureRef,
} from '@abstrack/types';
import type { EpisodeRow } from '@abstrack/types';
import {
  canonicalOpenPassEpisodeSymptomRowsByPresetLine,
  compareEpisodeSymptomRowsForHistory,
  computeSymptomResumePlacement,
  createDefaultSymptomPromptAnswer,
  createInitialSymptomPromptSession,
  episodeSymptomRowsToAnswersMapForOpenPass,
  formatEpisodeSymptomHistoryDetail,
  formatEpisodeDurationSimple,
  symptomPromptAnswerHasValue,
} from '@abstrack/types';
import {
  cancelActiveEpisodeById,
  deleteCurrentPassEpisodeSymptomAnswer,
  endEpisodeIfStillActive,
  getEpisodeById,
  insertEpisodeSymptomAnswer,
  listEpisodeMediaForEpisode,
  listEpisodeSymptomsForEpisode,
  listPresetSymptomsForPreset,
  uploadConfirmedEpisodeMedia,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import {
  useUnsavedChangesLeaveGuard,
  type PendingLeaveAction,
} from '@/lib/use-unsaved-changes-leave-guard';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '@/lib/episode-flow/symptom-prompt-session-store';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import { SymptomPromptResponseField } from './SymptomPromptResponseField';
import { EpisodeLocaleInstant } from '../episodes/EpisodeLocaleInstant';

export type SymptomPromptFlowProps = {
  /** `episodes.id` from the route. */
  episodeId: string;
  /** `symptom_presets.id` for the active episode (from template at start). */
  symptomPresetId: string;
  /**
   * When true (e.g. `?resume=1` from home), initial step follows merged server + session answers
   * instead of session index alone.
   */
  resumeFromEntry?: boolean;
};

/** Delay before writing free-text drafts to `sessionStorage` (keystrokes stay snappy in React state). */
const FREE_TEXT_PERSIST_DEBOUNCE_MS = 300;

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  const i = Math.trunc(index);
  return Math.max(0, Math.min(i, length - 1));
}

/** Queue key so the same preset symptom id does not serialize writes across episodes. */
function lineWriteQueueKey(episodeId: string, presetSymptomId: string): string {
  return `${episodeId}:${presetSymptomId}`;
}

/**
 * No form in this flow uses this id; the shared leave guard requires a truthy `exemptFormId` to
 * register submit capture so non-exempt forms (all of them, here) are intercepted.
 */
const SYMPTOM_FLOW_LEAVE_GUARD_EXEMPT_FORM_ID =
  '__symptom_prompt_leave_guard_no_exempt__';

/**
 * Releases a browser blob URL created for capture preview/upload after the bytes are in Storage.
 */
function revokeSymptomCaptureBlobUrlIfPresent(uri: string): void {
  if (!uri || typeof URL === 'undefined') {
    return;
  }
  if (uri.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      // Already revoked or invalid — ignore.
    }
  }
}

/**
 * Maps a MIME type to a filename extension for Storage keys. Strips parameters (`;codecs=…`)
 * because `Blob.type` / `MediaRecorder.mimeType` often include them.
 */
function mediaExtensionFromContentType(contentType: string): string {
  const base = contentType.trim().split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base) {
    return 'bin';
  }
  if (base === 'image/jpeg') {
    return 'jpg';
  }
  if (base === 'image/png') {
    return 'png';
  }
  if (base === 'image/webp') {
    return 'webp';
  }
  if (base === 'video/webm') {
    return 'webm';
  }
  if (base === 'video/mp4') {
    return 'mp4';
  }
  if (base === 'video/quicktime') {
    return 'mov';
  }
  return 'bin';
}

async function getWebMediaUploadData(answer: SymptomPromptAnswer): Promise<{
  body: Blob;
  contentType: string;
  extension: string;
  durationSeconds: number | null;
}> {
  if (answer.type !== 'photo' && answer.type !== 'video') {
    throw new Error('Media upload requires a photo/video answer.');
  }
  if (!answer.value?.localUri?.trim()) {
    throw new Error('No captured media is available to upload.');
  }
  const response = await fetch(answer.value.localUri);
  if (!response.ok) {
    const statusText = response.statusText?.trim();
    const httpDetail = `${response.status}${
      statusText ? ` ${statusText}` : ''
    }`;
    throw new Error(
      `Could not read captured media (${httpDetail}). The preview may have expired — capture again.`,
    );
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error(
      'Captured media file is empty or unreadable. Capture again.',
    );
  }
  const fallbackContentType =
    answer.type === 'photo' ? 'image/jpeg' : 'video/webm';
  const contentType = blob.type || fallbackContentType;
  const durationSeconds =
    answer.type === 'video' && answer.value.durationMs != null
      ? Math.max(1, Math.min(15, Math.round(answer.value.durationMs / 1000)))
      : null;
  return {
    body: blob,
    contentType,
    extension: mediaExtensionFromContentType(contentType),
    durationSeconds,
  };
}

/**
 * Linear symptom stepper for the active episode’s preset (Week 5 skeleton).
 *
 * @param props - Episode and symptom preset identifiers.
 * @returns One symptom at a time with back/next and session-scoped progress.
 */
export function SymptomPromptFlow({
  episodeId,
  symptomPresetId,
  resumeFromEntry = false,
}: SymptomPromptFlowProps) {
  const router = useRouter();
  const { announce } = useAnnounce();

  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [symptomHistory, setSymptomHistory] = useState<EpisodeSymptomRow[]>([]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState(
    () => createInitialSymptomPromptSession().answers,
  );

  const episodeIdRef = useRef(episodeId);
  const activeIndexRef = useRef(activeIndex);
  const answersRef = useRef(answers);
  const textPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Latest staged free-text payload; flushed on explicit commit actions. */
  const pendingServerFreeTextPersistRef = useRef<{
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  } | null>(null);
  /**
   * Per (episode, preset symptom) write queue so insert/delete requests execute in user action
   * order within an episode only — not across `episodeId` changes while mounted.
   */
  const lineWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);
  /**
   * Bumped only by {@link cancelPendingServerPersist}. Used with mount + episode id to gate
   * {@link setPersistError} only — insert/delete for the captured `enqueueEpisodeId` always runs
   * so Supabase stays aligned when the user navigates or cancels staged work.
   */
  const serverPersistEpochRef = useRef(0);
  /**
   * Increments on every enqueue of {@link executeServerPersist} / {@link executeServerDelete}.
   * Completions only call {@link setPersistError} when their captured id still equals this ref so
   * out-of-order finishes across lines cannot clear a newer failure (or show stale errors).
   */
  const persistUiAttemptRef = useRef(0);
  /** Suppresses {@link setPersistError} after unmount (epoch is not bumped on unmount). */
  const isMountedRef = useRef(true);
  /**
   * When true, unmount must not write `sessionStorage` (flush text debounce + snapshot). Set before
   * {@link continueToHealthMarkers} or cancel-episode navigation so cleanup does not undo
   * {@link clearSymptomPromptSession}.
   */
  const omitSymptomPromptSnapshotOnUnmountRef = useRef(false);

  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);
  const [endEpisodeDialogOpen, setEndEpisodeDialogOpen] = useState(false);
  const [endingEpisode, setEndingEpisode] = useState(false);
  const [endEpisodeError, setEndEpisodeError] = useState<string | null>(null);
  const [episodeForEndCta, setEpisodeForEndCta] = useState<EpisodeRow | null>(
    null,
  );
  const lastPostMarkerStepCompletedAtRef = useRef<string | null>(null);
  const pendingLeaveRef = useRef<PendingLeaveAction | null>(null);
  /**
   * When `episodeId` / `symptomPresetId` change, the layout reset syncs this to `resumeFromEntry` so a
   * new episode is not stuck in “resume from home” after visiting with `?resume=1` earlier.
   * While the route is unchanged, `resumeFromEntry` may become true later, or the URL may strip
   * `resume` after load — the render latch below keeps intent stable for that case.
   */
  const resumeFromHomeIntentRef = useRef(!!resumeFromEntry);
  if (resumeFromEntry) {
    resumeFromHomeIntentRef.current = true;
  }

  const supabase = useMemo(() => createBrowserClient(), []);

  /**
   * Resolves the signed-in user id for RLS writes, caching on {@link userIdRef}.
   * Used by `load()` (before inputs enable) and as a fallback in {@link executeServerPersist}.
   */
  const resolveSessionUserId = useCallback(
    async (
      supabase: ReturnType<typeof createBrowserClient>,
    ): Promise<string | null> => {
      if (userIdRef.current) {
        return userIdRef.current;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const id = user?.id ?? null;
      userIdRef.current = id;
      return id;
    },
    [],
  );

  /** Keep refs aligned before paint so exit / unmount persist cannot read a stale step after Next. */
  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useLayoutEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const executeServerPersist = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      /** Captured at enqueue so queued work cannot attach to a later episode after route change. */
      const enqueueEpisodeId = episodeIdRef.current;
      const enqueueEpoch = serverPersistEpochRef.current;
      persistUiAttemptRef.current += 1;
      const attemptId = persistUiAttemptRef.current;
      const queueKey = lineWriteQueueKey(enqueueEpisodeId, line.id);

      const queues = lineWriteQueueRef.current;
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // Keep the chain alive so later writes still run.
        })
        .then(async () => {
          const targetEpisodeId = enqueueEpisodeId;
          const uid = await resolveSessionUserId(supabase);
          if (!uid) {
            if (
              isMountedRef.current &&
              episodeIdRef.current === enqueueEpisodeId &&
              enqueueEpoch === serverPersistEpochRef.current &&
              attemptId === persistUiAttemptRef.current
            ) {
              setPersistError(
                'Your session could not be verified. Try signing in again.',
              );
            }
            return;
          }
          const r = await insertEpisodeSymptomAnswer(supabase, {
            userId: uid,
            episodeId: targetEpisodeId,
            line,
            answer,
          });
          if (r.ok && (answer.type === 'photo' || answer.type === 'video')) {
            try {
              const upload = await getWebMediaUploadData(answer);
              const mediaPersist = await uploadConfirmedEpisodeMedia(supabase, {
                userId: uid,
                episodeId: targetEpisodeId,
                episodeSymptomId: r.data.id,
                mediaType: answer.type,
                body: upload.body,
                contentType: upload.contentType,
                extension: upload.extension,
                durationSeconds: upload.durationSeconds,
                supersedeOpenPassPresetSymptomAnswers: {
                  presetSymptomId: line.id,
                  lastPostMarkerStepCompletedAt:
                    lastPostMarkerStepCompletedAtRef.current,
                },
              });
              if (!mediaPersist.ok) {
                if (
                  isMountedRef.current &&
                  episodeIdRef.current === enqueueEpisodeId &&
                  enqueueEpoch === serverPersistEpochRef.current &&
                  attemptId === persistUiAttemptRef.current
                ) {
                  setPersistError(mediaPersist.error.message);
                }
                return;
              }
              if (
                isMountedRef.current &&
                episodeIdRef.current === enqueueEpisodeId &&
                enqueueEpoch === serverPersistEpochRef.current &&
                attemptId === persistUiAttemptRef.current
              ) {
                const row = mediaPersist.data;
                const storageUri = `storage:${row.storage_object_key}`;
                const capturedAt =
                  row.upload_completed_at ??
                  (answer.type === 'photo' || answer.type === 'video'
                    ? answer.value?.capturedAt
                    : undefined) ??
                  new Date().toISOString();
                const patched: SymptomPromptAnswer =
                  answer.type === 'photo'
                    ? {
                        type: 'photo',
                        value: {
                          localUri: storageUri,
                          capturedAt,
                        },
                      }
                    : {
                        type: 'video',
                        value: {
                          localUri: storageUri,
                          durationMs:
                            row.duration_seconds != null
                              ? row.duration_seconds * 1000
                              : (answer.value?.durationMs ?? null),
                          capturedAt,
                        },
                      };
                const priorCaptureUri =
                  answer.type === 'photo' || answer.type === 'video'
                    ? (answer.value?.localUri ?? '')
                    : '';
                setAnswers((prev) => {
                  const next = { ...prev, [line.id]: patched };
                  answersRef.current = next;
                  setSymptomPromptSession(enqueueEpisodeId, {
                    activeIndex: activeIndexRef.current,
                    answers: next,
                  });
                  return next;
                });
                revokeSymptomCaptureBlobUrlIfPresent(priorCaptureUri);
              }
            } catch (caught) {
              if (
                isMountedRef.current &&
                episodeIdRef.current === enqueueEpisodeId &&
                enqueueEpoch === serverPersistEpochRef.current &&
                attemptId === persistUiAttemptRef.current
              ) {
                setPersistError(
                  caught instanceof Error
                    ? caught.message
                    : 'Could not upload captured media.',
                );
              }
              return;
            }
          }
          // Epoch/mount/episode/attempt gate UI only — the insert above always ran for `targetEpisodeId`.
          if (
            isMountedRef.current &&
            episodeIdRef.current === enqueueEpisodeId &&
            enqueueEpoch === serverPersistEpochRef.current &&
            attemptId === persistUiAttemptRef.current
          ) {
            if (!r.ok) {
              setPersistError(r.error.message);
            } else {
              setPersistError(null);
            }
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId, supabase],
  );

  const executeServerDelete = useCallback(
    (line: PresetSymptomRow) => {
      const enqueueEpisodeId = episodeIdRef.current;
      const enqueueEpoch = serverPersistEpochRef.current;
      persistUiAttemptRef.current += 1;
      const attemptId = persistUiAttemptRef.current;
      const queueKey = lineWriteQueueKey(enqueueEpisodeId, line.id);

      const queues = lineWriteQueueRef.current;
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // Keep the chain alive so later writes still run.
        })
        .then(async () => {
          const targetEpisodeId = enqueueEpisodeId;
          const uid = await resolveSessionUserId(supabase);
          if (!uid) {
            if (
              isMountedRef.current &&
              episodeIdRef.current === enqueueEpisodeId &&
              enqueueEpoch === serverPersistEpochRef.current &&
              attemptId === persistUiAttemptRef.current
            ) {
              setPersistError(
                'Your session could not be verified. Try signing in again.',
              );
            }
            return;
          }
          const r = await deleteCurrentPassEpisodeSymptomAnswer(supabase, {
            episodeId: targetEpisodeId,
            presetSymptomId: line.id,
            lastPostMarkerStepCompletedAt:
              lastPostMarkerStepCompletedAtRef.current,
          });
          // Epoch/mount/episode/attempt gate UI only — the delete above always ran for `targetEpisodeId`.
          if (
            isMountedRef.current &&
            episodeIdRef.current === enqueueEpisodeId &&
            enqueueEpoch === serverPersistEpochRef.current &&
            attemptId === persistUiAttemptRef.current
          ) {
            if (!r.ok) {
              setPersistError(r.error.message);
            } else {
              setPersistError(null);
            }
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId, supabase],
  );

  /**
   * Flushes the latest staged free-text payload (if any). Call before navigation / unmount so the
   * last keystrokes are committed once per explicit transition.
   */
  const flushPendingServerPersist = useCallback(() => {
    const pending = pendingServerFreeTextPersistRef.current;
    pendingServerFreeTextPersistRef.current = null;
    if (!pending) {
      return;
    }
    executeServerPersist(pending.line, pending.answer);
  }, [executeServerPersist]);

  /**
   * Cancels any pending staged free-text insert and invalidates older in-flight persists.
   * Used before skip/delete so a delayed insert cannot recreate a row after delete.
   */
  const cancelPendingServerPersist = useCallback(() => {
    pendingServerFreeTextPersistRef.current = null;
    serverPersistEpochRef.current += 1;
  }, []);

  const schedulePersistToSupabase = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      if (!symptomPromptAnswerHasValue(answer)) {
        cancelPendingServerPersist();
        executeServerDelete(line);
        return;
      }
      if (answer.type === 'free_text') {
        pendingServerFreeTextPersistRef.current = { line, answer };
        // Intentional: append-only insert semantics for free-text require explicit commit writes
        // (Next/Back/route change) to avoid generating duplicate rows from typing pauses.
      } else {
        pendingServerFreeTextPersistRef.current = null;
        executeServerPersist(line, answer);
      }
    },
    [cancelPendingServerPersist, executeServerDelete, executeServerPersist],
  );

  useLayoutEffect(() => {
    const outgoingEpisodeId = episodeIdRef.current;
    if (textPersistTimerRef.current !== null) {
      clearTimeout(textPersistTimerRef.current);
      textPersistTimerRef.current = null;
      setSymptomPromptSession(outgoingEpisodeId, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
    }
    flushPendingServerPersist();
    resumeFromHomeIntentRef.current = !!resumeFromEntry;
    episodeIdRef.current = episodeId;
    const s = getSymptomPromptSession(episodeId);
    setActiveIndex(s.activeIndex);
    setAnswers(s.answers);
    answersRef.current = s.answers;
    activeIndexRef.current = s.activeIndex;
    setStatus('loading');
    setErrorMessage(null);
    setLines([]);
    setSymptomHistory([]);
    setHydrated(true);
  }, [episodeId, symptomPresetId, flushPendingServerPersist]);

  const flushPendingTextPersist = useCallback(() => {
    if (textPersistTimerRef.current === null) {
      return;
    }
    clearTimeout(textPersistTimerRef.current);
    textPersistTimerRef.current = null;
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
  }, []);

  const onRequestDiscardDialog = useCallback(() => {
    setDiscardDialogOpen(true);
  }, []);

  const handleDiscardConfirm = useCallback(() => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;

    if (!action) {
      router.push('/dashboard');
      return;
    }
    if (action.kind === 'form') {
      action.form.submit();
      return;
    }
    const { href } = action;
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      router.push('/dashboard');
      return;
    }
    if (url.origin !== window.location.origin) {
      window.location.assign(href);
      return;
    }
    router.push(`${url.pathname}${url.search}${url.hash}`);
  }, [flushPendingServerPersist, flushPendingTextPersist, router]);

  useUnsavedChangesLeaveGuard({
    active: status === 'ready',
    dialogOpen: discardDialogOpen,
    pendingLeaveRef,
    onRequestDiscard: onRequestDiscardDialog,
    exemptFormId: SYMPTOM_FLOW_LEAVE_GUARD_EXEMPT_FORM_ID,
  });

  useEffect(() => {
    return () => {
      const omit = omitSymptomPromptSnapshotOnUnmountRef.current;
      if (!omit) {
        flushPendingTextPersist();
      } else if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      flushPendingServerPersist();
      if (!omit) {
        setSymptomPromptSession(episodeIdRef.current, {
          activeIndex: activeIndexRef.current,
          answers: answersRef.current,
        });
      }
    };
  }, [flushPendingServerPersist, flushPendingTextPersist]);

  const persistImmediate = useCallback(
    (nextIndex: number, nextAnswers: typeof answers) => {
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: nextIndex,
        answers: nextAnswers,
      });
    },
    [],
  );

  const load = useCallback(async () => {
    const myGen = ++loadGenRef.current;
    const stale = () => myGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    const uid = await resolveSessionUserId(supabase);
    if (stale()) {
      return;
    }
    if (!uid) {
      setErrorMessage(
        'You must be signed in to save symptom answers. Try signing in again.',
      );
      setStatus('error');
      return;
    }
    const ep = await getEpisodeById(supabase, episodeId);
    if (stale()) {
      return;
    }
    if (!ep.ok) {
      setErrorMessage(ep.error.message);
      setStatus('error');
      return;
    }
    if (!ep.data) {
      setErrorMessage('Could not load this episode.');
      setStatus('error');
      return;
    }
    setEpisodeForEndCta(ep.data);
    const passBoundary = ep.data.post_marker_step_completed_at ?? null;
    lastPostMarkerStepCompletedAtRef.current = passBoundary;

    const result = await listPresetSymptomsForPreset(supabase, symptomPresetId);
    if (stale()) {
      return;
    }
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setStatus('error');
      return;
    }
    setLines(result.data);
    const fromServer = await listEpisodeSymptomsForEpisode(
      supabase,
      episodeId,
      {
        orderBy: 'recent',
      },
    );
    if (stale()) {
      return;
    }
    const serverAnswers = fromServer.ok
      ? episodeSymptomRowsToAnswersMapForOpenPass(fromServer.data, passBoundary)
      : {};
    const mediaRows = await listEpisodeMediaForEpisode(supabase, episodeId);
    if (stale()) {
      return;
    }
    if (fromServer.ok && mediaRows.ok) {
      // `listEpisodeMediaForEpisode` is newest-first; keep the first hit per `episode_symptom_id`.
      const mediaBySymptomId = new Map<
        string,
        (typeof mediaRows.data)[number]
      >();
      for (const row of mediaRows.data) {
        if (!row.episode_symptom_id || !row.upload_completed_at) {
          continue;
        }
        const key = row.episode_symptom_id as string;
        if (!mediaBySymptomId.has(key)) {
          mediaBySymptomId.set(key, row);
        }
      }
      const canonicalSymptomRows =
        canonicalOpenPassEpisodeSymptomRowsByPresetLine(
          fromServer.data,
          passBoundary,
        );
      for (const row of Object.values(canonicalSymptomRows)) {
        if (!row.preset_symptom_id) {
          continue;
        }
        const media = mediaBySymptomId.get(row.id);
        if (!media) {
          continue;
        }
        if (row.response_type === 'photo') {
          const value: SymptomPromptPhotoCaptureRef = {
            localUri: `storage:${media.storage_object_key}`,
            capturedAt: media.upload_completed_at ?? row.created_at,
          };
          serverAnswers[row.preset_symptom_id] = { type: 'photo', value };
          continue;
        }
        if (row.response_type === 'video') {
          const value: SymptomPromptVideoCaptureRef = {
            localUri: `storage:${media.storage_object_key}`,
            durationMs:
              media.duration_seconds != null
                ? media.duration_seconds * 1000
                : null,
            capturedAt: media.upload_completed_at ?? row.created_at,
          };
          serverAnswers[row.preset_symptom_id] = { type: 'video', value };
        }
      }
    }
    if (fromServer.ok) {
      setSymptomHistory(
        fromServer.data.slice().sort(compareEpisodeSymptomRowsForHistory),
      );
    } else {
      setSymptomHistory([]);
    }
    const session = getSymptomPromptSession(episodeId);
    // Session overlays server so local drafts survive hydrate (debounced/offline/failed sync).
    const mergedAnswers = { ...serverAnswers, ...session.answers };
    let idx: number;
    const treatAsResumeFromHome = resumeFromHomeIntentRef.current;
    if (treatAsResumeFromHome) {
      const placement = computeSymptomResumePlacement(
        result.data,
        mergedAnswers,
      );
      if (placement.phase === 'complete') {
        idx = placement.activeIndex;
      } else {
        const sIdx = clampIndex(session.activeIndex, result.data.length);
        const pIdx = placement.activeIndex;
        // `session.activeIndex` can be 0 if persist ran before refs caught up with Next (fixed via
        // useLayoutEffect). `placement` is first unanswered from merged server + session answers.
        // Max covers stale 0 + answered first line → land on the second symptom as expected.
        idx = clampIndex(Math.max(sIdx, pIdx), result.data.length);
      }
    } else {
      idx = clampIndex(session.activeIndex, result.data.length);
    }
    setActiveIndex(idx);
    setAnswers(mergedAnswers);
    answersRef.current = mergedAnswers;
    activeIndexRef.current = idx;
    setSymptomPromptSession(episodeId, {
      activeIndex: idx,
      answers: mergedAnswers,
    });
    if (!fromServer.ok) {
      setPersistError(fromServer.error.message);
    } else if (!mediaRows.ok) {
      setPersistError(mediaRows.error.message);
    }
    setStatus('ready');
  }, [episodeId, symptomPresetId, resolveSessionUserId, supabase]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!resumeFromEntry || status !== 'ready') {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has('resume')) {
      return;
    }
    url.searchParams.delete('resume');
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [resumeFromEntry, router, status]);

  const currentLine = lines[activeIndex] ?? null;
  const currentAnswer = currentLine ? answers[currentLine.id] : undefined;
  const currentLineAnswered = symptomPromptAnswerHasValue(currentAnswer);
  const canProceedWithNext = !currentLine || currentLineAnswered;
  const canSkipCurrentLine = Boolean(currentLine) && !currentLineAnswered;
  const stepLabel =
    lines.length === 0
      ? 'No symptoms'
      : `Step ${activeIndex + 1} of ${lines.length}`;

  useEffect(() => {
    if (!hydrated || status !== 'ready' || !currentLine) {
      return;
    }
    announce(`${stepLabel}. ${currentLine.symptom_name}.`, {
      politeness: 'polite',
    });
  }, [
    activeIndex,
    announce,
    currentLine,
    hydrated,
    lines.length,
    status,
    stepLabel,
  ]);

  const onChangeAnswer = (next: SymptomPromptAnswer) => {
    if (!currentLine) {
      return;
    }
    const merged: SymptomPromptAnswers = {
      ...answersRef.current,
      [currentLine.id]: next,
    };
    answersRef.current = merged;
    setAnswers(merged);
    schedulePersistToSupabase(currentLine, next);

    if (next.type === 'free_text') {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
      }
      textPersistTimerRef.current = setTimeout(() => {
        textPersistTimerRef.current = null;
        setSymptomPromptSession(episodeIdRef.current, {
          activeIndex: activeIndexRef.current,
          answers: answersRef.current,
        });
      }, FREE_TEXT_PERSIST_DEBOUNCE_MS);
    } else {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: activeIndexRef.current,
        answers: merged,
      });
    }
  };

  const advanceToNextStep = () => {
    if (lines.length === 0) {
      continueToHealthMarkers();
      return;
    }
    const idx = activeIndexRef.current;
    if (idx < lines.length - 1) {
      const next = idx + 1;
      activeIndexRef.current = next;
      setActiveIndex(next);
      persistImmediate(next, answersRef.current);
      return;
    }
    continueToHealthMarkers();
    announce('Symptom list complete.', { politeness: 'polite' });
  };

  const continueToHealthMarkers = useCallback(() => {
    omitSymptomPromptSnapshotOnUnmountRef.current = true;
    // Preserve symptom step position so health-marker "Back" returns here.
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
    const q = new URLSearchParams();
    if (resumeFromHomeIntentRef.current) {
      q.set('resume', '1');
    }
    const query = q.toString();
    router.replace(
      `/episode/${episodeIdRef.current}/health-markers${
        query ? `?${query}` : ''
      }`,
    );
  }, [router]);

  const goBackStep = () => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    const idx = activeIndexRef.current;
    if (idx <= 0) {
      return;
    }
    const next = idx - 1;
    activeIndexRef.current = next;
    setActiveIndex(next);
    persistImmediate(next, answersRef.current);
    announce(`Back to step ${next + 1} of ${lines.length}.`, {
      politeness: 'polite',
    });
  };

  const confirmExitFlow = useCallback(() => {
    pendingLeaveRef.current = { kind: 'href', href: '/dashboard' };
    setDiscardDialogOpen(true);
  }, []);

  const confirmCancelEpisode = useCallback(() => {
    setCancelDialogOpen(true);
  }, []);

  const handleCancelEpisodeConfirm = useCallback(async (): Promise<
    void | false
  > => {
    if (cancelingEpisode) {
      return false;
    }
    setCancelingEpisode(true);
    try {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      cancelPendingServerPersist();
      const result = await cancelActiveEpisodeById(
        supabase,
        episodeIdRef.current,
      );
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      clearSymptomPromptSession(episodeIdRef.current);
      omitSymptomPromptSnapshotOnUnmountRef.current = true;
      if (result.data.didCancel) {
        announce('Episode canceled. Resume is no longer available.', {
          politeness: 'polite',
        });
      } else {
        announce('This episode is no longer active.', { politeness: 'polite' });
      }
      router.push('/dashboard');
      return;
    } finally {
      setCancelingEpisode(false);
    }
  }, [
    announce,
    cancelPendingServerPersist,
    cancelingEpisode,
    router,
    supabase,
  ]);

  const handleEndEpisodeConfirm = useCallback(async (): Promise<
    void | false
  > => {
    if (endingEpisode || !episodeForEndCta) {
      return false;
    }
    setEndingEpisode(true);
    setEndEpisodeError(null);
    try {
      const nowIso = new Date().toISOString();
      const startedAtMs = Date.parse(episodeForEndCta.started_at);
      const nowMs = Date.parse(nowIso);
      const endedAt =
        Number.isFinite(startedAtMs) &&
        Number.isFinite(nowMs) &&
        nowMs < startedAtMs
          ? episodeForEndCta.started_at
          : nowIso;
      const result = await endEpisodeIfStillActive(
        supabase,
        episodeId,
        endedAt,
        episodeForEndCta.started_at,
      );
      if (!result.ok) {
        setEndEpisodeError(result.error.message);
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      clearSymptomPromptSession(episodeId);
      omitSymptomPromptSnapshotOnUnmountRef.current = true;
      if (result.data.didEnd) {
        const durationText = formatEpisodeDurationSimple(
          episodeForEndCta.started_at,
          endedAt,
        );
        announce(
          durationText
            ? `Episode ended. Duration ${durationText}.`
            : 'Episode ended.',
          { politeness: 'polite' },
        );
        setEndEpisodeDialogOpen(false);
        router.push('/dashboard');
        return;
      }
      setEndEpisodeError('This episode is no longer active.');
      return false;
    } finally {
      setEndingEpisode(false);
    }
  }, [announce, endingEpisode, episodeForEndCta, episodeId, router, supabase]);

  const goNext = () => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    advanceToNextStep();
  };

  const skipCurrentSymptom = () => {
    if (!currentLine) {
      return;
    }
    flushPendingTextPersist();
    cancelPendingServerPersist();
    const skippedAnswer = createDefaultSymptomPromptAnswer(
      currentLine.response_type,
    );
    const merged: SymptomPromptAnswers = {
      ...answersRef.current,
      [currentLine.id]: skippedAnswer,
    };
    answersRef.current = merged;
    setAnswers(merged);
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: merged,
    });
    executeServerDelete(currentLine);
    announce(`Skipped ${currentLine.symptom_name}.`, { politeness: 'polite' });
    advanceToNextStep();
  };

  if (status === 'loading') {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        <p className="text-sm text-app-muted" role="status">
          Loading symptom list…
        </p>
      </div>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {errorMessage}
        </p>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-app-muted">
            <button
              type="button"
              onClick={confirmExitFlow}
              className="rounded-md text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none transition hover:text-app-ink hover:decoration-app-primary focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              ← Back to dashboard
            </button>
          </p>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
            Episode symptoms
          </h1>
          {persistError ? (
            <p
              className="mt-2 text-sm text-amber-800 dark:text-amber-200"
              role="status"
            >
              Could not sync with the server: {persistError}
            </p>
          ) : null}
        </div>

        <p className="text-base font-medium text-app-muted">{stepLabel}</p>

        {lines.length === 0 ? (
          <div
            className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            role="status"
          >
            <p className="text-sm leading-relaxed text-app-ink">
              This preset has no symptoms yet. You can add symptoms under
              Templates when you are not in an episode.
            </p>
          </div>
        ) : currentLine ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-app-ink">
              {currentLine.symptom_name}
            </h2>
            {currentLine.prompt_instruction ? (
              <p className="text-sm leading-relaxed text-app-muted">
                {currentLine.prompt_instruction}
              </p>
            ) : null}
            <SymptomPromptResponseField
              line={currentLine}
              answer={answers[currentLine.id]}
              onChange={onChangeAnswer}
              disabled={status !== 'ready'}
            />
          </div>
        ) : null}

        {symptomHistory.length > 0 ? (
          <section
            className="rounded-2xl border border-app-border/90 bg-app-surface/60 p-4"
            aria-label="Symptom history in this episode"
          >
            <h2 className="text-sm font-semibold text-app-ink">
              Symptom history in this episode
            </h2>
            <p
              className="mt-1 text-xs text-app-muted"
              id="ep-symptom-history-hint"
            >
              Oldest first. Each entry is saved as its own row.
            </p>
            <ol
              className="mt-3 list-decimal space-y-2 pl-5 text-sm text-app-ink"
              aria-describedby="ep-symptom-history-hint"
            >
              {symptomHistory.map((row) => (
                <li key={row.id} className="break-words">
                  <span className="text-app-muted">
                    <EpisodeLocaleInstant iso={row.created_at} />
                    {' — '}
                  </span>
                  {row.symptom_name}: {formatEpisodeSymptomHistoryDetail(row)}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          {activeIndex > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={goBackStep}
            >
              Back
            </button>
          ) : null}
          {currentLine ? (
            <button
              type="button"
              disabled={!canSkipCurrentLine}
              className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
                canSkipCurrentLine
                  ? 'hover:bg-app-surface/80'
                  : 'cursor-not-allowed opacity-50'
              }`}
              onClick={skipCurrentSymptom}
            >
              Skip symptom
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canProceedWithNext}
            className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl px-4 text-base font-semibold text-white shadow-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 ${
              canProceedWithNext
                ? 'bg-red-700 hover:bg-red-800 dark:hover:bg-red-500'
                : 'cursor-not-allowed bg-red-400 opacity-60 dark:bg-red-800'
            }`}
            onClick={goNext}
          >
            {lines.length === 0 ? 'Done' : 'Next'}
          </button>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-base font-medium text-app-muted transition hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={confirmExitFlow}
        >
          Exit symptom flow
        </button>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
          onClick={confirmCancelEpisode}
        >
          Cancel episode
        </button>
        {episodeForEndCta?.post_marker_step_completed_at &&
        !episodeForEndCta.ended_at ? (
          <>
            <button
              type="button"
              className="inline-flex min-h-[48px] w-full max-w-md items-center justify-center rounded-xl border-2 border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={() => {
                setEndEpisodeDialogOpen(true);
              }}
            >
              End this episode
            </button>
            {endEpisodeError ? (
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {endEpisodeError}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discardDialogOpen}
        title="Exit symptom flow?"
        description="If you exit now, you will return to the dashboard. This episode stays open, your progress is saved, and you can resume from home when you are ready."
        confirmLabel="Exit"
        cancelLabel="Stay"
        onConfirm={() => {
          handleDiscardConfirm();
        }}
        onClose={() => {
          pendingLeaveRef.current = null;
          setDiscardDialogOpen(false);
        }}
      />
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel this active episode?"
        description="Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
        confirmLabel="Cancel episode"
        confirmBusyLabel="Canceling episode…"
        cancelLabel="Keep episode"
        onConfirm={handleCancelEpisodeConfirm}
        onClose={() => {
          setCancelDialogOpen(false);
        }}
      />
      <ConfirmDialog
        open={endEpisodeDialogOpen}
        title="End this episode now?"
        description="Ending sets this episode as complete. You can still view it in your episode history when you are ready."
        confirmLabel="End episode"
        confirmBusyLabel="Ending episode…"
        cancelLabel="Not yet"
        onConfirm={handleEndEpisodeConfirm}
        onClose={() => {
          setEndEpisodeDialogOpen(false);
        }}
      />
    </>
  );
}
