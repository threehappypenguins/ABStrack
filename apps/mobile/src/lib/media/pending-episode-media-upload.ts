/**
 * Offline episode media upload queue: ciphertext files on disk (see
 * {@link writeEncryptedMediaBytesToFile}) plus a local-only PowerSync table. Completes with
 * {@link uploadConfirmedEpisodeMedia} when connectivity returns.
 *
 * **When uploads run:** {@link runPendingEpisodeMediaUploadWorker} is invoked from
 * {@link PowerSyncSessionBridge} when the PowerSync DB opens, when the app returns to the
 * foreground, when NetInfo reports a connection that is not definitively offline (including while
 * `isInternetReachable` is still unknown), and after PowerSync reports a healthy synced status.
 * Triggers use {@link createDebouncedPendingEpisodeMediaFlush}, which enforces a **minimum interval**
 * between worker runs and supports {@link PendingEpisodeMediaFlushHandle.cancel} so teardown can drop
 * trailing timers without invoking the worker after unmount.
 * A periodic backup also runs while the DB is open. Rows retry with exponential backoff on failure.
 */
import {
  uploadConfirmedEpisodeMedia,
  type PresetDataError,
} from '@abstrack/supabase';
import type { MediaType, Uuid } from '@abstrack/types';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  deleteEncryptedPendingMediaFileBestEffort,
  readEncryptedMediaFileToArrayBuffer,
  writeEncryptedMediaBytesToFile,
} from './device-pending-media-crypto';
import { getOrCreateDeviceSqlcipherKey } from '../powersync/powersync-sqlcipher-key';
import { newRandomUuidV4 } from '../random-uuid';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../supabase-wiring';
import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';

function newQueueId(): string {
  return newRandomUuidV4();
}

function backoffMsAfterAttempt(attemptCount: number): number {
  return Math.min(120_000, 2 ** Math.min(attemptCount, 16) * 250);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pendingMediaUploadSignalRequestedStop(
  signal: AbortSignal | null | undefined,
): boolean {
  return signal?.aborted === true;
}

/**
 * When several symptom steps queued media offline, `episode_media.insert` can run before PowerSync
 * finishes uploading the matching `episode_symptoms` row (REST sees FK 23503). Short inline waits
 * let CRUD catch up within one drain instead of surfacing warns + a second flush.
 */
const PENDING_MEDIA_PARENT_SYMPTOM_FK_MAX_WAITS = 18;
const PENDING_MEDIA_PARENT_SYMPTOM_FK_WAIT_MS = 120;

/**
 * Ensures only one pending-media drain runs at a time. Without this, opening the DB plus NetInfo /
 * AppState both invoke the worker and two concurrent runs can produce duplicate logs (and redundant
 * Storage traffic) while processing the same SQLite snapshot.
 */
let pendingMediaUploadDrainChain: Promise<void> = Promise.resolve();

/**
 * Reads `episodes.post_marker_step_completed_at` from the local replica so queued rows use the same
 * open-pass boundary as SQLite — React refs can lag or jump after navigation/marker completion while
 * offline rows still reflect an older snapshot.
 *
 * @param db - Open PowerSync database.
 * @param episodeId - Episode id.
 */
async function readEpisodePassBoundaryFromReplica(
  db: PowerSyncDatabase,
  episodeId: string,
): Promise<string | null> {
  const raw = await db.getOptional<{
    post_marker_step_completed_at: string | null;
  }>(`SELECT post_marker_step_completed_at FROM episodes WHERE id = ?`, [
    episodeId,
  ]);
  if (!raw) {
    throw new Error(
      `Cannot enqueue pending episode media: episode ${episodeId} missing from local replica.`,
    );
  }
  const v = raw.post_marker_step_completed_at;
  return v == null || String(v).trim() === '' ? null : String(v);
}

/**
 * SQL predicate for rows queued for the same open-pass boundary as
 * `episodes.post_marker_step_completed_at` (null / empty string ⇔ first pass before marker).
 *
 * @param columnName - SQLite column on `pending_episode_media_upload`.
 * @param boundary - Pass boundary snapshot stored when the row was enqueued.
 */
function pendingEpisodeMediaUploadPassBoundaryPredicate(
  columnName: string,
  boundary: string | null | undefined,
): { sql: string; params: unknown[] } {
  const b = boundary == null || boundary === '' ? null : boundary;
  if (b == null) {
    return {
      sql: `(${columnName} IS NULL OR ${columnName} = '')`,
      params: [],
    };
  }
  return { sql: `${columnName} = ?`, params: [b] };
}

function isMissingEncryptedPendingMediaFileError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('filenotfoundexception') ||
    m.includes('enoent') ||
    (m.includes('filesystemfile.bytes') &&
      (m.includes('no such file or directory') || m.includes('open failed')))
  );
}

/**
 * True when a failed upload should enter the encrypted offline queue instead of hard-failing the prompt.
 *
 * @param error - Result from {@link uploadConfirmedEpisodeMedia} or transport.
 */
export function shouldQueueEpisodeMediaUploadError(
  error: PresetDataError,
): boolean {
  return error.code === 'network_error' || error.code === 'unknown';
}

/**
 * Deletes queue rows (and ciphertext files) for specific `episode_symptoms` ids — call when those
 * steps are removed locally before uploads complete.
 *
 * @param db - Open PowerSync database.
 * @param episodeSymptomIds - Symptom row ids whose pending payloads should be dropped.
 */
export async function removePendingEpisodeMediaUploadsForSymptomIds(
  db: PowerSyncDatabase,
  episodeSymptomIds: string[],
): Promise<void> {
  if (episodeSymptomIds.length === 0) {
    return;
  }
  const placeholders = episodeSymptomIds.map(() => '?').join(', ');
  const rows = await db.getAll<{
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
  }>(
    `SELECT primary_cipher_relative_path, thumbnail_cipher_relative_path FROM pending_episode_media_upload WHERE episode_symptom_id IN (${placeholders})`,
    episodeSymptomIds,
  );
  for (const r of rows) {
    deleteEncryptedPendingMediaFileBestEffort(r.primary_cipher_relative_path);
    deleteEncryptedPendingMediaFileBestEffort(r.thumbnail_cipher_relative_path);
  }
  await db.execute(
    `DELETE FROM pending_episode_media_upload WHERE episode_symptom_id IN (${placeholders})`,
    episodeSymptomIds,
  );
}

/**
 * Deletes all pending media uploads for an episode (episode cancel/delete).
 *
 * @param db - Open PowerSync database.
 * @param episodeId - Episode id.
 */
export async function removePendingEpisodeMediaUploadsForEpisodeId(
  db: PowerSyncDatabase,
  episodeId: string,
): Promise<void> {
  const rows = await db.getAll<{
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
  }>(
    `SELECT primary_cipher_relative_path, thumbnail_cipher_relative_path FROM pending_episode_media_upload WHERE episode_id = ?`,
    [episodeId],
  );
  for (const r of rows) {
    deleteEncryptedPendingMediaFileBestEffort(r.primary_cipher_relative_path);
    deleteEncryptedPendingMediaFileBestEffort(r.thumbnail_cipher_relative_path);
  }
  await db.execute(
    `DELETE FROM pending_episode_media_upload WHERE episode_id = ?`,
    [episodeId],
  );
}

/**
 * Drops pending ciphertext uploads whose `user_id` does not match the signed-in Supabase user.
 * Call after account switches or when draining uploads so another account’s rows cannot run against
 * the current session (RLS / permission mismatch) or crowd out the owner’s batch.
 *
 * @param db - Open PowerSync database.
 * @param signedInUserId - Current `session.user.id`.
 */
export async function removePendingEpisodeMediaUploadsNotOwnedByUser(
  db: PowerSyncDatabase,
  signedInUserId: string,
): Promise<void> {
  const rows = await db.getAll<{
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
  }>(
    `SELECT primary_cipher_relative_path, thumbnail_cipher_relative_path FROM pending_episode_media_upload WHERE user_id != ?`,
    [signedInUserId],
  );
  for (const r of rows) {
    deleteEncryptedPendingMediaFileBestEffort(r.primary_cipher_relative_path);
    deleteEncryptedPendingMediaFileBestEffort(r.thumbnail_cipher_relative_path);
  }
  await db.execute(
    `DELETE FROM pending_episode_media_upload WHERE user_id != ?`,
    [signedInUserId],
  );
}

/**
 * Drops queued ciphertext uploads tied to one `episode_symptoms` row (after that observation has
 * uploaded successfully inline).
 *
 * @param db - Open PowerSync database.
 * @param episodeSymptomId - Symptom observation row id.
 */
export async function removePendingEpisodeMediaUploadsForEpisodeSymptomRow(
  db: PowerSyncDatabase,
  episodeSymptomId: string,
): Promise<void> {
  const rows = await db.getAll<{
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
  }>(
    `SELECT primary_cipher_relative_path, thumbnail_cipher_relative_path FROM pending_episode_media_upload WHERE episode_symptom_id = ?`,
    [episodeSymptomId],
  );
  for (const r of rows) {
    deleteEncryptedPendingMediaFileBestEffort(r.primary_cipher_relative_path);
    deleteEncryptedPendingMediaFileBestEffort(r.thumbnail_cipher_relative_path);
  }
  await db.execute(
    `DELETE FROM pending_episode_media_upload WHERE episode_symptom_id = ?`,
    [episodeSymptomId],
  );
}

/**
 * Encrypts capture bytes, stores metadata locally, and replaces any prior pending rows for the same
 * episode + preset symptom line **and** open-pass boundary (`last_post_marker_step_completed_at`).
 * Each offline-first persist inserts a new `episode_symptoms` row; replacement therefore targets
 * those dimensions rather than only `episode_symptom_id`, so stale queue rows tied to superseded
 * symptom ids cannot linger with dangling ciphertext paths.
 *
 * The pass boundary is read from `episodes.post_marker_step_completed_at` in SQLite at enqueue time
 * (not from UI refs) so it stays aligned with the replica when marker completion updates the episode.
 *
 * After a successful DB commit, deletes ciphertext files previously queued for that line so
 * `abstrack/pending-media/` does not accumulate orphans on “record again”.
 *
 * **Atomicity:** `DELETE` + `INSERT` run inside one SQLite `BEGIN IMMEDIATE` … `COMMIT` so a failed
 * insert rolls back the delete (queue rows for the same line are not dropped without a successor).
 * If any DB step fails after the new ciphertext files were written, this function **best-effort**
 * deletes `primaryPath` / `thumbPath` so those files are not left without a queue row (filesystem
 * writes cannot participate in the SQL transaction).
 *
 * @param db - Open PowerSync database.
 * @param args - Linkage + already-normalized upload payload from the capture pipeline.
 */
export async function enqueuePendingEpisodeMediaUploadFromCapture(
  db: PowerSyncDatabase,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    episodeSymptomId: Uuid;
    presetSymptomId: Uuid;
    mediaType: MediaType;
    upload: {
      body: ArrayBuffer;
      contentType: string;
      extension: string;
      durationSeconds: number | null;
      thumbnail: { body: ArrayBuffer; contentType: string };
    };
  },
): Promise<void> {
  const keyMaterial = await getOrCreateDeviceSqlcipherKey();
  const rowId = newQueueId();
  const now = new Date().toISOString();
  const primaryPath = `abstrack/pending-media/${rowId}-primary.bin`;
  const thumbPath = `abstrack/pending-media/${rowId}-thumb.jpg`;

  const boundary = await readEpisodePassBoundaryFromReplica(db, args.episodeId);
  const pass = pendingEpisodeMediaUploadPassBoundaryPredicate(
    'last_post_marker_step_completed_at',
    boundary,
  );
  const replacedRows = await db.getAll<{
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
  }>(
    `SELECT primary_cipher_relative_path, thumbnail_cipher_relative_path FROM pending_episode_media_upload WHERE episode_id = ? AND preset_symptom_id = ? AND ${pass.sql}`,
    [args.episodeId, args.presetSymptomId, ...pass.params],
  );

  await writeEncryptedMediaBytesToFile(
    keyMaterial,
    primaryPath,
    args.upload.body,
  );
  await writeEncryptedMediaBytesToFile(
    keyMaterial,
    thumbPath,
    args.upload.thumbnail.body,
  );

  try {
    await db.execute('BEGIN IMMEDIATE');
    try {
      await db.execute(
        `DELETE FROM pending_episode_media_upload WHERE episode_id = ? AND preset_symptom_id = ? AND ${pass.sql}`,
        [args.episodeId, args.presetSymptomId, ...pass.params],
      );

      await db.execute(
        `INSERT INTO pending_episode_media_upload (
       id, user_id, episode_id, episode_symptom_id, preset_symptom_id, last_post_marker_step_completed_at,
       media_type, content_type_primary, extension, duration_seconds,
       primary_cipher_relative_path, thumbnail_cipher_relative_path,
       attempt_count, last_attempt_at, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rowId,
          args.userId,
          args.episodeId,
          args.episodeSymptomId,
          args.presetSymptomId,
          boundary,
          args.mediaType,
          args.upload.contentType,
          args.upload.extension,
          args.upload.durationSeconds ?? null,
          primaryPath,
          thumbPath,
          0,
          null,
          null,
          now,
          now,
        ],
      );

      await db.execute('COMMIT');
    } catch (inner) {
      try {
        await db.execute('ROLLBACK');
      } catch {
        /* ignore: may not be in a transaction (e.g. BEGIN failed first) */
      }
      throw inner;
    }
  } catch (e) {
    deleteEncryptedPendingMediaFileBestEffort(primaryPath);
    deleteEncryptedPendingMediaFileBestEffort(thumbPath);
    throw e;
  }

  for (const r of replacedRows) {
    deleteEncryptedPendingMediaFileBestEffort(r.primary_cipher_relative_path);
    deleteEncryptedPendingMediaFileBestEffort(r.thumbnail_cipher_relative_path);
  }
}

/**
 * Options for {@link runPendingEpisodeMediaUploadWorker}.
 */
export type RunPendingEpisodeMediaUploadWorkerOptions = {
  maxBatch?: number;
  /**
   * When aborted (e.g. PowerSync flush teardown), the worker stops before starting further rows.
   * In-flight HTTP uploads are not cancelled; FK retry sleeps bail out early when possible.
   */
  signal?: AbortSignal | null;
};

/**
 * Implementation for {@link runPendingEpisodeMediaUploadWorker} (runs after mutex acquisition).
 */
async function runPendingEpisodeMediaUploadWorkerImpl(
  db: PowerSyncDatabase,
  options: RunPendingEpisodeMediaUploadWorkerOptions,
): Promise<{ processed: number; failures: number }> {
  const maxBatch = options.maxBatch ?? 5;
  const signal = options.signal ?? undefined;

  if (pendingMediaUploadSignalRequestedStop(signal)) {
    return { processed: 0, failures: 0 };
  }

  const online = await fetchMobileDeviceIsConnected();
  if (pendingMediaUploadSignalRequestedStop(signal)) {
    return { processed: 0, failures: 0 };
  }
  // Bail only on definitive offline; `null` (unknown reachability / fetch error) still tries — matches
  // PowerSyncSessionBridge + file header; row failures use backoff.
  if (online === false) {
    return { processed: 0, failures: 0 };
  }

  if (pendingMediaUploadSignalRequestedStop(signal)) {
    return { processed: 0, failures: 0 };
  }

  const {
    data: { session },
  } = await getMobileAuthSessionSafe();
  const uid = session?.user?.id;
  if (!uid) {
    return { processed: 0, failures: 0 };
  }

  if (pendingMediaUploadSignalRequestedStop(signal)) {
    return { processed: 0, failures: 0 };
  }

  await removePendingEpisodeMediaUploadsNotOwnedByUser(db, uid);

  const supabase = getMobileSupabaseClient();
  const keyMaterial = await getOrCreateDeviceSqlcipherKey();

  const rows = await db.getAll<{
    id: string;
    user_id: string;
    episode_id: string;
    episode_symptom_id: string;
    preset_symptom_id: string;
    last_post_marker_step_completed_at: string | null;
    media_type: string;
    content_type_primary: string;
    extension: string;
    duration_seconds: number | null;
    primary_cipher_relative_path: string;
    thumbnail_cipher_relative_path: string;
    attempt_count: number | null;
    last_attempt_at: string | null;
  }>(
    `SELECT * FROM pending_episode_media_upload WHERE user_id = ? ORDER BY created_at ASC LIMIT ?`,
    [uid, maxBatch],
  );

  let processed = 0;
  let failures = 0;

  for (const row of rows) {
    if (pendingMediaUploadSignalRequestedStop(signal)) {
      break;
    }
    const attempts = row.attempt_count ?? 0;
    if (attempts > 0 && row.last_attempt_at) {
      const elapsed = Date.now() - Date.parse(row.last_attempt_at);
      if (
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < backoffMsAfterAttempt(attempts)
      ) {
        continue;
      }
    }

    const nowIso = new Date().toISOString();

    try {
      if (pendingMediaUploadSignalRequestedStop(signal)) {
        break;
      }

      const primaryBody = await readEncryptedMediaFileToArrayBuffer(
        keyMaterial,
        row.primary_cipher_relative_path,
      );
      const thumbBody = await readEncryptedMediaFileToArrayBuffer(
        keyMaterial,
        row.thumbnail_cipher_relative_path,
      );

      if (pendingMediaUploadSignalRequestedStop(signal)) {
        break;
      }

      const mediaType: 'photo' | 'video' =
        row.media_type === 'video' ? 'video' : 'photo';
      const lastPost =
        row.last_post_marker_step_completed_at == null ||
        row.last_post_marker_step_completed_at === ''
          ? null
          : row.last_post_marker_step_completed_at;

      const uploadPayload = {
        userId: uid as Uuid,
        episodeId: row.episode_id as Uuid,
        episodeSymptomId: row.episode_symptom_id as Uuid,
        mediaType,
        body: primaryBody,
        contentType: row.content_type_primary,
        extension: row.extension,
        durationSeconds:
          mediaType === 'video' ? (row.duration_seconds ?? null) : null,
        thumbnail: {
          body: thumbBody,
          contentType: 'image/jpeg',
        },
        supersedeOpenPassPresetSymptomAnswers: {
          presetSymptomId: row.preset_symptom_id as Uuid,
          lastPostMarkerStepCompletedAt: lastPost,
        },
      };

      let result = await uploadConfirmedEpisodeMedia(supabase, uploadPayload);
      let parentSymptomFkWaits = 0;
      while (
        !result.ok &&
        result.error.code === 'foreign_key_violation' &&
        parentSymptomFkWaits < PENDING_MEDIA_PARENT_SYMPTOM_FK_MAX_WAITS
      ) {
        if (pendingMediaUploadSignalRequestedStop(signal)) {
          break;
        }
        await delayMs(PENDING_MEDIA_PARENT_SYMPTOM_FK_WAIT_MS);
        parentSymptomFkWaits++;
        if (pendingMediaUploadSignalRequestedStop(signal)) {
          break;
        }
        result = await uploadConfirmedEpisodeMedia(supabase, uploadPayload);
      }

      if (pendingMediaUploadSignalRequestedStop(signal)) {
        break;
      }

      if (!result.ok) {
        failures += 1;
        await db.execute(
          `UPDATE pending_episode_media_upload SET attempt_count = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          [attempts + 1, nowIso, result.error.message, nowIso, row.id],
        );
        continue;
      }

      if (pendingMediaUploadSignalRequestedStop(signal)) {
        break;
      }

      deleteEncryptedPendingMediaFileBestEffort(
        row.primary_cipher_relative_path,
      );
      deleteEncryptedPendingMediaFileBestEffort(
        row.thumbnail_cipher_relative_path,
      );
      await db.execute(
        `DELETE FROM pending_episode_media_upload WHERE id = ?`,
        [row.id],
      );
      processed += 1;
    } catch (e) {
      if (pendingMediaUploadSignalRequestedStop(signal)) {
        break;
      }
      failures += 1;
      const message = e instanceof Error ? e.message : String(e);
      if (isMissingEncryptedPendingMediaFileError(message)) {
        deleteEncryptedPendingMediaFileBestEffort(
          row.primary_cipher_relative_path,
        );
        deleteEncryptedPendingMediaFileBestEffort(
          row.thumbnail_cipher_relative_path,
        );
        await db.execute(
          `DELETE FROM pending_episode_media_upload WHERE id = ?`,
          [row.id],
        );
        continue;
      }
      await db.execute(
        `UPDATE pending_episode_media_upload SET attempt_count = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        [attempts + 1, nowIso, message, nowIso, row.id],
      );
    }
  }

  return { processed, failures };
}

/**
 * Drains pending episode media (see {@link runPendingEpisodeMediaUploadWorkerImpl}). Overlapping
 * calls are queued so only one drain executes at a time.
 *
 * Skips work when {@link fetchMobileDeviceIsConnected} is **`false`** only; **`null`** (reachability
 * still resolving or fetch failed) still runs the drain so the queue is not starved — same policy as
 * {@link PowerSyncSessionBridge}.
 *
 * @param db - Open PowerSync DB, or `null` to no-op.
 * @param options - {@link RunPendingEpisodeMediaUploadWorkerOptions}
 */
export function runPendingEpisodeMediaUploadWorker(
  db: PowerSyncDatabase | null | undefined,
  options: RunPendingEpisodeMediaUploadWorkerOptions = {},
): Promise<{ processed: number; failures: number }> {
  if (!db) {
    return Promise.resolve({ processed: 0, failures: 0 });
  }
  if (pendingMediaUploadSignalRequestedStop(options.signal)) {
    return Promise.resolve({ processed: 0, failures: 0 });
  }
  const done = pendingMediaUploadDrainChain.then(
    () => runPendingEpisodeMediaUploadWorkerImpl(db, options),
    () => runPendingEpisodeMediaUploadWorkerImpl(db, options),
  );
  pendingMediaUploadDrainChain = done.then(
    () => undefined,
    () => undefined,
  );
  return done;
}

/**
 * Handle returned by {@link createDebouncedPendingEpisodeMediaFlush}: invoke {@link flush} from
 * NetInfo/AppState; call {@link cancel} from React effect cleanup so timers abort and
 * {@link runPendingEpisodeMediaUploadWorker} exits promptly via {@link signal}.
 */
export type PendingEpisodeMediaFlushHandle = {
  flush: () => void;
  cancel: () => void;
  /** AbortSignal aborted when {@link cancel} runs — pass into {@link runPendingEpisodeMediaUploadWorker}. */
  readonly signal: AbortSignal;
};

/**
 * Schedules {@link runPendingEpisodeMediaUploadWorker} with a **minimum interval** between runs.
 * Skipped calls coalesce into one trailing timer so bursts during reconnect still yield a drain once
 * the interval elapses. Call {@link PendingEpisodeMediaFlushHandle.cancel} on teardown.
 *
 * @param getDb - Resolves the current PowerSync handle (may be `null`).
 * @param minIntervalMs - Minimum milliseconds between worker invocations (default `2500`).
 */
export function createDebouncedPendingEpisodeMediaFlush(
  getDb: () => PowerSyncDatabase | null,
  minIntervalMs = 2500,
): PendingEpisodeMediaFlushHandle {
  let lastRunAt = 0;
  let released = false;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  const abortController = new AbortController();
  const { signal } = abortController;

  const cancel = () => {
    released = true;
    abortController.abort();
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  };

  const flush = () => {
    if (released) {
      return;
    }
    const now = Date.now();
    const elapsedSinceLast =
      lastRunAt > 0 ? Math.max(0, now - lastRunAt) : minIntervalMs;

    if (lastRunAt > 0 && elapsedSinceLast < minIntervalMs) {
      const delay = minIntervalMs - elapsedSinceLast;
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
      }
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        if (released) {
          return;
        }
        lastRunAt = Date.now();
        void runPendingEpisodeMediaUploadWorker(getDb(), { signal });
      }, delay);
      return;
    }

    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    lastRunAt = now;
    void runPendingEpisodeMediaUploadWorker(getDb(), { signal });
  };

  return { flush, cancel, signal };
}
