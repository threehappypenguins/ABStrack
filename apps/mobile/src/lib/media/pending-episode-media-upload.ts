/**
 * Offline episode media upload queue: ciphertext files on disk (see
 * {@link writeEncryptedMediaBytesToFile}) plus a local-only PowerSync table. Completes with
 * {@link uploadConfirmedEpisodeMedia} when connectivity returns.
 */
import { uploadConfirmedEpisodeMedia, type PresetDataError } from '@abstrack/supabase';
import type { MediaType, Uuid } from '@abstrack/types';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  deleteEncryptedPendingMediaFileBestEffort,
  readEncryptedMediaFileToArrayBuffer,
  writeEncryptedMediaBytesToFile,
} from './device-pending-media-crypto';
import { getOrCreateDeviceSqlcipherKey } from '../powersync/powersync-sqlcipher-key';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../supabase-wiring';

function newQueueId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  throw new Error('crypto.randomUUID is unavailable.');
}

function backoffMsAfterAttempt(attemptCount: number): number {
  return Math.min(120_000, 2 ** Math.min(attemptCount, 16) * 250);
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
 * Encrypts capture bytes, stores metadata locally, and replaces any prior pending row for the same
 * symptom step.
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
    lastPostMarkerStepCompletedAt: string | null;
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

  await db.execute(
    `DELETE FROM pending_episode_media_upload WHERE episode_symptom_id = ?`,
    [args.episodeSymptomId],
  );

  const boundary =
    args.lastPostMarkerStepCompletedAt == null ||
    args.lastPostMarkerStepCompletedAt === ''
      ? null
      : args.lastPostMarkerStepCompletedAt;

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
}

/**
 * Drains pending rows: decrypts, uploads to Storage, inserts `episode_media` server-side, then
 * removes ciphertext files and the queue row. Applies exponential backoff per row on transient
 * failures without creating duplicate final objects (Storage rollback remains inside
 * {@link uploadConfirmedEpisodeMedia}).
 *
 * @param db - Open PowerSync DB, or `null` to no-op.
 * @param options.maxBatch - Max rows to attempt per run (default `5`).
 * @returns Counts for diagnostics/logging.
 */
export async function runPendingEpisodeMediaUploadWorker(
  db: PowerSyncDatabase | null | undefined,
  options: { maxBatch?: number } = {},
): Promise<{ processed: number; failures: number }> {
  const maxBatch = options.maxBatch ?? 5;
  if (!db) {
    return { processed: 0, failures: 0 };
  }

  const {
    data: { session },
  } = await getMobileAuthSessionSafe();
  const uid = session?.user?.id;
  if (!uid) {
    return { processed: 0, failures: 0 };
  }

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
    `SELECT * FROM pending_episode_media_upload ORDER BY created_at ASC LIMIT ?`,
    [maxBatch],
  );

  let processed = 0;
  let failures = 0;

  for (const row of rows) {
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
      const primaryBody = await readEncryptedMediaFileToArrayBuffer(
        keyMaterial,
        row.primary_cipher_relative_path,
      );
      const thumbBody = await readEncryptedMediaFileToArrayBuffer(
        keyMaterial,
        row.thumbnail_cipher_relative_path,
      );

      const mediaType = row.media_type === 'video' ? 'video' : 'photo';
      const lastPost =
        row.last_post_marker_step_completed_at == null ||
        row.last_post_marker_step_completed_at === ''
          ? null
          : row.last_post_marker_step_completed_at;

      const result = await uploadConfirmedEpisodeMedia(supabase, {
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
      });

      if (!result.ok) {
        failures += 1;
        await db.execute(
          `UPDATE pending_episode_media_upload SET attempt_count = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          [attempts + 1, nowIso, result.error.message, nowIso, row.id],
        );
        continue;
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
      failures += 1;
      const message = e instanceof Error ? e.message : String(e);
      await db.execute(
        `UPDATE pending_episode_media_upload SET attempt_count = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        [attempts + 1, nowIso, message, nowIso, row.id],
      );
    }
  }

  return { processed, failures };
}

/**
 * Registers a debounced runner that processes the pending media queue when the app is foregrounded
 * or the PowerSync socket is up. Safe to call once from app shell code.
 *
 * @param getDb - Resolves the current PowerSync handle (may be `null`).
 * @param delayMs - Debounce window.
 */
export function createDebouncedPendingEpisodeMediaFlush(
  getDb: () => PowerSyncDatabase | null,
  delayMs = 800,
): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) {
      clearTimeout(t);
    }
    t = setTimeout(() => {
      t = undefined;
      void runPendingEpisodeMediaUploadWorker(getDb());
    }, delayMs);
  };
}
