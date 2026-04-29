import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { File as ExpoFile } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { RouteProp } from '@react-navigation/native';
import {
  CommonActions,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  EpisodeRow,
  EpisodeSymptomRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomPromptPhotoCaptureRef,
  SymptomPromptAnswers,
  SymptomPromptVideoCaptureRef,
} from '@abstrack/types';
import {
  canonicalOpenPassEpisodeSymptomRowsByPresetLine,
  compareEpisodeSymptomRowsForHistory,
  computeSymptomResumePlacement,
  createDefaultSymptomPromptAnswer,
  episodeMediaStoragePathHintsFromPromptAnswer,
  episodeSymptomRowsToAnswersMapForOpenPass,
  formatEpisodeSymptomHistoryDetail,
  formatEpisodeDurationSimple,
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
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
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '../../lib/episodes/symptom-prompt-session-store';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { SymptomPromptResponseField } from '../components/episode-flow/SymptomPromptResponseField';
import { ScreenShell } from '../components/ScreenShell';
import { EpisodeFlowSecondaryActionsSection } from '../components/episode-flow/EpisodeFlowSecondaryActionsSection';
import type { MainStackParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';

type SymptomPromptRoute = RouteProp<MainStackParamList, 'SymptomPrompt'>;
type SymptomPromptNav = NativeStackNavigationProp<
  MainStackParamList,
  'SymptomPrompt'
>;
const VIDEO_MAX_DURATION_SECONDS = Math.floor(
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS / 1000,
);

/** Long edge (px) for JPEG thumbnails stored beside primary objects in `episode-media`. */
const SYMPTOM_MEDIA_THUMB_MAX_EDGE_PX = 480;

/**
 * Reads intrinsic pixel dimensions for a local image URI (used to cap the **longer** edge when
 * resizing thumbnails). Uses the promise form of {@link Image.getSize} so tests/native mocks stay
 * aligned with RN’s `NativeImageLoader*.getSize` contract.
 *
 * @param uri - `file://` or other URI accepted by {@link Image.getSize}.
 * @returns `{ width, height }` when available, otherwise `null` (caller may fall back to width-only resize).
 */
async function getImagePixelSize(
  uri: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await Image.getSize(uri);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

function thumbnailResizeActionForLongEdge(
  width: number,
  height: number,
  maxEdgePx: number,
): { resize: { width?: number; height?: number } }[] {
  if (height > width) {
    return [{ resize: { height: maxEdgePx } }];
  }
  return [{ resize: { width: maxEdgePx } }];
}

/**
 * Builds reduced JPEG bytes for a lightweight thumbnail object (same bucket/prefix as primary).
 *
 * @param answer - Photo or video symptom answer with a readable `localUri`.
 * @param mediaUri - Trimmed capture URI passed to native imaging APIs.
 */
async function buildMobileEpisodeMediaThumbnail(
  answer: SymptomPromptAnswer,
  mediaUri: string,
): Promise<ArrayBuffer> {
  const maxEdge = SYMPTOM_MEDIA_THUMB_MAX_EDGE_PX;
  if (answer.type === 'photo') {
    const size = await getImagePixelSize(mediaUri);
    const actions =
      size !== null
        ? thumbnailResizeActionForLongEdge(size.width, size.height, maxEdge)
        : [{ resize: { width: maxEdge } }];
    const result = await manipulateAsync(mediaUri, actions, {
      compress: 0.82,
      format: SaveFormat.JPEG,
    });
    return await new ExpoFile(result.uri).arrayBuffer();
  }
  if (answer.type === 'video') {
    const { uri: frameUri } = await VideoThumbnails.getThumbnailAsync(
      mediaUri,
      {
        time: 500,
      },
    );
    const size = await getImagePixelSize(frameUri);
    const actions =
      size !== null
        ? thumbnailResizeActionForLongEdge(size.width, size.height, maxEdge)
        : [{ resize: { width: maxEdge } }];
    const result = await manipulateAsync(frameUri, actions, {
      compress: 0.82,
      format: SaveFormat.JPEG,
    });
    return await new ExpoFile(result.uri).arrayBuffer();
  }
  throw new Error('Thumbnail encoding requires a photo or video answer.');
}

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

function formatSymptomHistoryInstant(isoLike: string): string {
  const ms = Date.parse(isoLike);
  if (!Number.isFinite(ms)) {
    return isoLike;
  }
  return new Date(ms).toLocaleString();
}

function contentTypeGuessFromLocalUri(
  mediaType: 'photo' | 'video',
  uri: string,
): string {
  const pathOnly = uri.split('?')[0] ?? uri;
  const lower = pathOnly.toLowerCase();
  if (mediaType === 'photo') {
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.heic')) {
      return 'image/heic';
    }
    if (lower.endsWith('.heif')) {
      return 'image/heif';
    }
    return 'image/jpeg';
  }
  if (lower.endsWith('.mov')) {
    return 'video/quicktime';
  }
  if (lower.endsWith('.webm')) {
    return 'video/webm';
  }
  return 'video/mp4';
}

function mediaExtensionFromContentType(contentType: string): string {
  const ct = contentType.trim().toLowerCase();
  if (ct === 'image/jpeg') {
    return 'jpg';
  }
  if (ct === 'image/png') {
    return 'png';
  }
  if (ct === 'image/webp') {
    return 'webp';
  }
  if (ct === 'image/gif') {
    return 'gif';
  }
  if (ct === 'image/heic') {
    return 'heic';
  }
  if (ct === 'image/heif') {
    return 'heif';
  }
  if (ct === 'video/mp4') {
    return 'mp4';
  }
  if (ct === 'video/quicktime') {
    return 'mov';
  }
  if (ct === 'video/webm') {
    return 'webm';
  }
  return 'bin';
}

async function getMobileMediaUploadData(answer: SymptomPromptAnswer): Promise<{
  body: ArrayBuffer;
  contentType: string;
  extension: string;
  durationSeconds: number | null;
  thumbnail: {
    body: ArrayBuffer;
    contentType: string;
    extension: string;
  };
}> {
  if (answer.type !== 'photo' && answer.type !== 'video') {
    throw new Error('Media upload requires a photo/video answer.');
  }
  if (!answer.value?.localUri?.trim()) {
    throw new Error('No captured media is available to upload.');
  }
  const uri = answer.value.localUri.trim();

  /**
   * Supabase Storage + React Native: `Blob`/`fetch(localUri)` uploads often fail at the transport
   * layer (`Network request failed`). Official guidance is to upload an `ArrayBuffer` built from
   * file bytes. Use Expo’s `File` class (`expo-file-system`) and `arrayBuffer()` — not legacy
   * `readAsStringAsync` + base64 — so uploads avoid extra decoding and match the current API.
   *
   * @see https://supabase.com/docs/guides/storage/uploads (React Native notes)
   */
  const body = await new ExpoFile(uri).arrayBuffer();

  const contentType = contentTypeGuessFromLocalUri(answer.type, uri);
  const durationSeconds =
    answer.type === 'video' && answer.value.durationMs != null
      ? Math.max(
          1,
          Math.min(
            VIDEO_MAX_DURATION_SECONDS,
            Math.round(answer.value.durationMs / 1000),
          ),
        )
      : null;

  const thumbBody = await buildMobileEpisodeMediaThumbnail(answer, uri);

  return {
    body,
    contentType,
    extension: mediaExtensionFromContentType(contentType),
    durationSeconds,
    thumbnail: {
      body: thumbBody,
      contentType: 'image/jpeg',
      extension: 'jpg',
    },
  };
}

/**
 * Linear symptom stepper for the active episode’s selected preset (Week 5 skeleton).
 *
 * @returns One symptom at a time with back/next and session-scoped progress.
 */
export function SymptomPromptScreen() {
  const navigation = useNavigation<SymptomPromptNav>();
  const route = useRoute<SymptomPromptRoute>();
  const {
    episodeId,
    symptomPresetId,
    resume: resumeFromEntry = false,
  } = route.params;

  /** Synced in {@link useLayoutEffect} when route params change so a latched “resume” does not apply to the next episode while this screen stays mounted. */
  const resumeFromHomeIntentRef = useRef(!!resumeFromEntry);

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [symptomHistory, setSymptomHistory] = useState<EpisodeSymptomRow[]>([]);

  const [activeIndex, setActiveIndex] = useState(
    () => getSymptomPromptSession(episodeId).activeIndex,
  );
  const [answers, setAnswers] = useState(
    () => getSymptomPromptSession(episodeId).answers,
  );
  const answersRef = useRef(answers);
  const activeIndexRef = useRef(activeIndex);
  const episodeIdRef = useRef(episodeId);
  /** Latest staged free-text payload for Supabase; flushed on explicit commit actions. */
  const pendingServerFreeTextPersistRef = useRef<{
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  } | null>(null);
  /**
   * Per (episode, preset symptom) write queue — ordering is within the active episode only, not
   * across `episodeId` changes while this screen stays mounted.
   */
  const lineWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);
  /**
   * Bumped only by {@link cancelPendingServerPersist}. Gates {@link setPersistError} when a cancel
   * invalidates UI feedback; queued writes still run for the episode id captured at enqueue time.
   */
  const serverPersistEpochRef = useRef(0);
  /**
   * Monotonic id per enqueue; only matching completions update {@link setPersistError} so
   * cross-line out-of-order results cannot clobber a newer failure or success state.
   */
  const persistUiAttemptRef = useRef(0);
  /** Suppresses {@link setPersistError} after unmount. */
  const isMountedRef = useRef(true);
  const allowRemovalRef = useRef(false);
  const lastPostMarkerStepCompletedAtRef = useRef<string | null>(null);
  const [episodeForEndCta, setEpisodeForEndCta] = useState<EpisodeRow | null>(
    null,
  );
  const [endingEpisode, setEndingEpisode] = useState(false);

  /**
   * Caches the auth user id on {@link userIdRef}. Called from {@link load} before `ready`, and
   * from {@link executeServerPersist} so writes never depend on a separate mount-only `getUser()`.
   */
  const resolveSessionUserId = useCallback(
    async (
      supabase: ReturnType<typeof getMobileSupabaseClient>,
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

  useLayoutEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const executeServerPersist = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
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
          const supabase = getMobileSupabaseClient();
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
              const upload = await getMobileMediaUploadData(answer);
              const mediaPersist = await uploadConfirmedEpisodeMedia(supabase, {
                userId: uid,
                episodeId: targetEpisodeId,
                episodeSymptomId: r.data.id,
                mediaType: answer.type,
                body: upload.body,
                contentType: upload.contentType,
                extension: upload.extension,
                durationSeconds: upload.durationSeconds,
                thumbnail: upload.thumbnail,
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
                const thumbnailStorageUri = row.thumbnail_storage_key
                  ? `storage:${row.thumbnail_storage_key}`
                  : null;
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
                          thumbnailStorageUri,
                          capturedAt,
                        },
                      }
                    : {
                        type: 'video',
                        value: {
                          localUri: storageUri,
                          thumbnailStorageUri,
                          durationMs:
                            row.duration_seconds != null
                              ? row.duration_seconds * 1000
                              : (answer.value?.durationMs ?? null),
                          capturedAt,
                        },
                      };
                setAnswers((prev) => {
                  const next = { ...prev, [line.id]: patched };
                  answersRef.current = next;
                  setSymptomPromptSession(enqueueEpisodeId, {
                    activeIndex: activeIndexRef.current,
                    answers: next,
                  });
                  return next;
                });
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
          if (enqueueEpoch !== serverPersistEpochRef.current) {
            return;
          }
          if (!isMountedRef.current) {
            return;
          }
          if (episodeIdRef.current !== enqueueEpisodeId) {
            return;
          }
          if (attemptId !== persistUiAttemptRef.current) {
            return;
          }
          if (!r.ok) {
            setPersistError(r.error.message);
          } else {
            setPersistError(null);
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId],
  );

  const executeServerDelete = useCallback(
    (
      line: PresetSymptomRow,
      options?: { episodeMediaPathHints?: (string | null | undefined)[] },
    ) => {
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
          const supabase = getMobileSupabaseClient();
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
            episodeMediaPathHints: options?.episodeMediaPathHints,
          });
          if (enqueueEpoch !== serverPersistEpochRef.current) {
            return;
          }
          if (!isMountedRef.current) {
            return;
          }
          if (episodeIdRef.current !== enqueueEpisodeId) {
            return;
          }
          if (attemptId !== persistUiAttemptRef.current) {
            return;
          }
          if (!r.ok) {
            setPersistError(r.error.message);
          } else {
            setPersistError(null);
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId],
  );

  /**
   * Flushes the latest staged free-text `{ line, answer }` (if any). Call from Next/Back,
   * `useLayoutEffect` (episode change), and unmount so the last keystrokes are committed once per
   * explicit transition.
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
   * Cancels pending staged free-text inserts and invalidates older in-flight persists.
   * Used on skip/delete so delayed inserts cannot recreate deleted symptom rows.
   */
  const cancelPendingServerPersist = useCallback(() => {
    pendingServerFreeTextPersistRef.current = null;
    serverPersistEpochRef.current += 1;
  }, []);

  /**
   * Schedules or runs a server upsert. User id is **not** read here: {@link executeServerPersist}
   * always calls {@link resolveSessionUserId} so the first answer after load cannot silently skip.
   */
  const schedulePersistToSupabase = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      if (!symptomPromptAnswerHasValue(answer)) {
        cancelPendingServerPersist();
        executeServerDelete(line);
        return;
      }
      if (answer.type === 'free_text') {
        pendingServerFreeTextPersistRef.current = { line, answer };
        // Intentional: free-text answers are insert-only now, so we stage while typing and only
        // write on explicit commit actions (Next/Back/unmount) via flushPendingServerPersist.
      } else {
        pendingServerFreeTextPersistRef.current = null;
        executeServerPersist(line, answer);
      }
    },
    [cancelPendingServerPersist, executeServerDelete, executeServerPersist],
  );

  useEffect(() => {
    return () => {
      // Do not bump serverPersistEpochRef here — queued per-line writes should still reach Supabase;
      // isMountedRef gates setPersistError after unmount.
      flushPendingServerPersist();
    };
  }, [flushPendingServerPersist]);

  const persist = useCallback(
    (nextIndex: number, nextAnswers: typeof answers) => {
      setSymptomPromptSession(episodeId, {
        activeIndex: nextIndex,
        answers: nextAnswers,
      });
    },
    [episodeId],
  );

  const load = useCallback(async () => {
    const myGen = ++loadGenRef.current;
    const stale = () => myGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    try {
      const supabase = getMobileSupabaseClient();
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

      const result = await listPresetSymptomsForPreset(
        supabase,
        symptomPresetId,
      );
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
        ? episodeSymptomRowsToAnswersMapForOpenPass(
            fromServer.data,
            passBoundary,
          )
        : {};
      const canonicalSymptomRowsForHydrate = fromServer.ok
        ? canonicalOpenPassEpisodeSymptomRowsByPresetLine(
            fromServer.data,
            passBoundary,
          )
        : {};
      const mediaRows = fromServer.ok
        ? await listEpisodeMediaForEpisode(supabase, episodeId, {
            episodeSymptomIds: Object.values(
              canonicalSymptomRowsForHydrate,
            ).map((r) => r.id),
          })
        : { ok: true as const, data: [] };
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
        for (const row of Object.values(canonicalSymptomRowsForHydrate)) {
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
              thumbnailStorageUri: media.thumbnail_storage_key
                ? `storage:${media.thumbnail_storage_key}`
                : null,
              capturedAt: media.upload_completed_at ?? row.created_at,
            };
            serverAnswers[row.preset_symptom_id] = { type: 'photo', value };
            continue;
          }
          if (row.response_type === 'video') {
            const value: SymptomPromptVideoCaptureRef = {
              localUri: `storage:${media.storage_object_key}`,
              thumbnailStorageUri: media.thumbnail_storage_key
                ? `storage:${media.thumbnail_storage_key}`
                : null,
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
          idx = clampIndex(Math.max(sIdx, pIdx), result.data.length);
        }
      } else {
        idx = clampIndex(session.activeIndex, result.data.length);
      }
      activeIndexRef.current = idx;
      setActiveIndex(idx);
      setAnswers(mergedAnswers);
      answersRef.current = mergedAnswers;
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
    } catch (caught: unknown) {
      if (stale()) {
        return;
      }
      const message =
        caught instanceof Error ? caught.message : 'Could not load symptoms.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [episodeId, symptomPresetId, resolveSessionUserId]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  useLayoutEffect(() => {
    flushPendingServerPersist();
    resumeFromHomeIntentRef.current = !!resumeFromEntry;
    episodeIdRef.current = episodeId;
    const s = getSymptomPromptSession(episodeId);
    activeIndexRef.current = s.activeIndex;
    setActiveIndex(s.activeIndex);
    setAnswers(s.answers);
    answersRef.current = s.answers;
    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    setLines([]);
    setSymptomHistory([]);
  }, [episodeId, symptomPresetId, resumeFromEntry, flushPendingServerPersist]);

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
    if (status !== 'ready' || !currentLine) {
      return;
    }
    announce(`${stepLabel}. ${currentLine.symptom_name}.`);
  }, [activeIndex, currentLine, lines.length, status, stepLabel]);

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
    persist(activeIndexRef.current, merged);
    schedulePersistToSupabase(currentLine, next);
  };

  const resolveEpisodeMediaPreviewUrl = useCallback(
    async (storageUri: string): Promise<string | null> => {
      const raw = storageUri.trim();
      const key = raw.startsWith('storage:')
        ? raw.slice('storage:'.length).trim()
        : raw;
      if (!key) {
        return null;
      }
      const supabase = getMobileSupabaseClient();
      if (!supabase.storage?.from) {
        return null;
      }
      const { data, error } = await supabase.storage
        .from('episode-media')
        .createSignedUrl(key, 180);
      if (error || !data?.signedUrl) {
        return null;
      }
      return data.signedUrl;
    },
    [],
  );

  const handleClearUploadedEpisodeMedia = useCallback(() => {
    if (!currentLine) {
      return;
    }
    if (
      currentLine.response_type !== 'photo' &&
      currentLine.response_type !== 'video'
    ) {
      return;
    }
    const priorAnswer = answersRef.current[currentLine.id];
    const episodeMediaPathHints =
      episodeMediaStoragePathHintsFromPromptAnswer(priorAnswer);
    cancelPendingServerPersist();
    const cleared = createDefaultSymptomPromptAnswer(currentLine.response_type);
    const merged: SymptomPromptAnswers = {
      ...answersRef.current,
      [currentLine.id]: cleared,
    };
    answersRef.current = merged;
    setAnswers(merged);
    persist(activeIndexRef.current, merged);
    executeServerDelete(currentLine, { episodeMediaPathHints });
  }, [cancelPendingServerPersist, currentLine, executeServerDelete, persist]);

  const goBackStep = () => {
    flushPendingServerPersist();
    const idx = activeIndexRef.current;
    if (idx <= 0) {
      return;
    }
    const next = idx - 1;
    activeIndexRef.current = next;
    setActiveIndex(next);
    persist(next, answersRef.current);
    announce(`Back to step ${next + 1} of ${lines.length}.`);
  };

  const confirmExitFlow = useCallback((action: () => void) => {
    Alert.alert(
      'Exit symptom flow?',
      'If you exit now, you will return home. This episode stays open, your progress is saved, and you can resume from home when you are ready.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: action,
        },
      ],
    );
  }, []);

  /** Resets the stack to MainTabs when the user confirms exit (matches “return home” copy; not `goBack`). */
  const exitSymptomFlowToHome = useCallback(() => {
    flushPendingServerPersist();
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
    allowRemovalRef.current = true;
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );
  }, [flushPendingServerPersist, navigation]);

  const requestExitToHome = useCallback(() => {
    confirmExitFlow(() => {
      exitSymptomFlowToHome();
    });
  }, [confirmExitFlow, exitSymptomFlowToHome]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (allowRemovalRef.current) {
        allowRemovalRef.current = false;
        return;
      }
      e.preventDefault();
      confirmExitFlow(() => {
        exitSymptomFlowToHome();
      });
    });
    return unsub;
  }, [confirmExitFlow, exitSymptomFlowToHome, navigation]);

  const onExitFlowPress = () => {
    requestExitToHome();
  };

  const onCancelEpisodePress = useCallback(() => {
    Alert.alert(
      'Cancel this active episode?',
      'Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
      [
        { text: 'Keep episode', style: 'cancel' },
        {
          text: 'Cancel episode',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              cancelPendingServerPersist();
              const result = await cancelActiveEpisodeById(
                getMobileSupabaseClient(),
                episodeIdRef.current,
              );
              if (!result.ok) {
                await announce(result.error.message, {
                  politeness: 'assertive',
                });
                return;
              }
              clearSymptomPromptSession(episodeIdRef.current);
              if (result.data.didCancel) {
                await announce(
                  'Episode canceled. Resume is no longer available.',
                  {
                    politeness: 'polite',
                  },
                );
              } else {
                await announce('This episode is no longer active.', {
                  politeness: 'polite',
                });
              }
              allowRemovalRef.current = true;
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'MainTabs' }],
                }),
              );
            })();
          },
        },
      ],
    );
  }, [cancelPendingServerPersist, navigation]);

  const onEndEpisodePress = useCallback(() => {
    if (endingEpisode || !episodeForEndCta) {
      return;
    }
    Alert.alert('End this episode now?', 'You can still view it in history.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'End episode',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!episodeForEndCta) {
              return;
            }
            setEndingEpisode(true);
            const nowIso = new Date().toISOString();
            const startedAtMs = Date.parse(episodeForEndCta.started_at);
            const nowMs = Date.parse(nowIso);
            const endedAt =
              Number.isFinite(startedAtMs) &&
              Number.isFinite(nowMs) &&
              nowMs < startedAtMs
                ? episodeForEndCta.started_at
                : nowIso;
            const supabase = getMobileSupabaseClient();
            const result = await endEpisodeIfStillActive(
              supabase,
              episodeId,
              endedAt,
              episodeForEndCta.started_at,
            );
            setEndingEpisode(false);
            if (!result.ok) {
              await announce(result.error.message, { politeness: 'assertive' });
              return;
            }
            clearSymptomPromptSession(episodeId);
            if (result.data.didEnd) {
              const durationText = formatEpisodeDurationSimple(
                episodeForEndCta.started_at,
                endedAt,
              );
              await announce(
                durationText
                  ? `Episode ended. Duration ${durationText}.`
                  : 'Episode ended.',
                { politeness: 'polite' },
              );
            }
            allowRemovalRef.current = true;
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'MainTabs' }],
              }),
            );
          })();
        },
      },
    ]);
  }, [endingEpisode, episodeForEndCta, episodeId, navigation]);

  const advanceToNextStep = () => {
    if (lines.length === 0) {
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
      allowRemovalRef.current = true;
      navigation.replace('HealthMarkerPrompt', {
        episodeId: episodeIdRef.current,
        resume: resumeFromHomeIntentRef.current || undefined,
      });
      return;
    }
    const idx = activeIndexRef.current;
    if (idx < lines.length - 1) {
      const next = idx + 1;
      activeIndexRef.current = next;
      setActiveIndex(next);
      persist(next, answersRef.current);
      return;
    }
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
    allowRemovalRef.current = true;
    navigation.replace('HealthMarkerPrompt', {
      episodeId: episodeIdRef.current,
      resume: resumeFromHomeIntentRef.current || undefined,
    });
    announce('Symptom list complete.');
  };

  const goNext = () => {
    flushPendingServerPersist();
    advanceToNextStep();
  };

  const skipCurrentSymptom = () => {
    if (!currentLine) {
      return;
    }
    const priorAnswer = answersRef.current[currentLine.id];
    const episodeMediaPathHints =
      episodeMediaStoragePathHintsFromPromptAnswer(priorAnswer);
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
    persist(activeIndexRef.current, merged);
    executeServerDelete(currentLine, { episodeMediaPathHints });
    announce(`Skipped ${currentLine.symptom_name}.`);
    advanceToNextStep();
  };

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-4">
        <Text
          accessibilityRole="header"
          className={`text-[22px] font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Episode symptoms
        </Text>
        {persistError ? (
          <Text
            accessibilityLiveRegion="polite"
            className={`text-sm text-amber-800 dark:text-amber-200`}
            maxFontSizeMultiplier={2}
          >
            Could not sync with the server: {persistError}
          </Text>
        ) : null}

        <AsyncScreenContainer
          status={status}
          loadingAccessibilityLabel="Loading symptom list"
          errorTitle="Could not load symptoms"
          errorMessage={errorMessage ?? undefined}
          onRetry={() => {
            void load();
          }}
        >
          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <Text
              accessibilityRole="text"
              className={`mb-2 text-base font-medium ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              {stepLabel}
            </Text>

            {lines.length === 0 ? (
              <Text
                className={`text-base leading-relaxed ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                This preset has no symptoms yet. You can add symptoms under
                Templates when you are not in an episode.
              </Text>
            ) : currentLine ? (
              <View className="gap-4">
                <Text
                  accessibilityRole="header"
                  className={`text-xl font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {currentLine.symptom_name}
                </Text>
                {currentLine.prompt_instruction ? (
                  <Text
                    className={`text-base leading-relaxed ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    {currentLine.prompt_instruction}
                  </Text>
                ) : null}
                <SymptomPromptResponseField
                  line={currentLine}
                  answer={answers[currentLine.id]}
                  onChange={onChangeAnswer}
                  disabled={status !== 'ready'}
                  resolveEpisodeMediaPreviewUrl={resolveEpisodeMediaPreviewUrl}
                  onClearUploadedEpisodeMedia={handleClearUploadedEpisodeMedia}
                />
              </View>
            ) : null}

            {symptomHistory.length > 0 ? (
              <View
                accessibilityLabel="Symptom history in this episode, oldest first"
                className="mt-6 rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-bg-dark"
              >
                <Text
                  className={`text-sm font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  Symptom history in this episode
                </Text>
                <Text
                  className={`mb-2 text-xs ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Oldest first. Each entry is saved as its own row.
                </Text>
                {symptomHistory.map((row) => (
                  <Text
                    key={row.id}
                    className={`mb-2 text-sm ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {formatSymptomHistoryInstant(row.created_at)} —{' '}
                    {row.symptom_name}: {formatEpisodeSymptomHistoryDetail(row)}
                  </Text>
                ))}
              </View>
            ) : null}

            <View className="mt-6 gap-3">
              {activeIndex > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous symptom"
                  onPress={goBackStep}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Back
                  </Text>
                </Pressable>
              ) : null}
              {currentLine ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Skip this symptom"
                  accessibilityState={{ disabled: !canSkipCurrentLine }}
                  disabled={!canSkipCurrentLine}
                  onPress={skipCurrentSymptom}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className={`w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 dark:border-app-border-dark dark:bg-app-bg-dark ${
                    canSkipCurrentLine ? 'active:opacity-90' : 'opacity-50'
                  }`}
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Skip
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  lines.length === 0 ? 'Done' : 'Next symptom'
                }
                accessibilityState={{ disabled: !canProceedWithNext }}
                disabled={!canProceedWithNext}
                onPress={goNext}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className={`w-full items-center justify-center rounded-xl px-3 py-4 dark:bg-red-600 ${
                  canProceedWithNext
                    ? 'bg-red-700 active:opacity-90'
                    : 'bg-red-400 opacity-60 dark:bg-red-800'
                }`}
              >
                <Text className="text-center text-[17px] font-semibold text-white">
                  {lines.length === 0 ? 'Done' : 'Next'}
                </Text>
              </Pressable>
            </View>

            <EpisodeFlowSecondaryActionsSection>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Exit symptom flow"
                onPress={onExitFlowPress}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
              >
                <Text
                  className={`text-base font-medium ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Exit symptom flow
                </Text>
              </Pressable>
              {episodeForEndCta?.post_marker_step_completed_at &&
              !episodeForEndCta.ended_at ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="End this episode"
                  accessibilityState={{ disabled: endingEpisode }}
                  disabled={endingEpisode}
                  onPress={onEndEpisodePress}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="mt-3 w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {endingEpisode ? 'Ending…' : 'End this episode'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel episode"
                onPress={onCancelEpisodePress}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="mt-3 w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
              >
                <Text
                  className="text-sm font-medium text-red-700 dark:text-red-300"
                  maxFontSizeMultiplier={2}
                >
                  Cancel episode
                </Text>
              </Pressable>
            </EpisodeFlowSecondaryActionsSection>
          </ScrollView>
        </AsyncScreenContainer>
      </View>
    </ScreenShell>
  );
}
