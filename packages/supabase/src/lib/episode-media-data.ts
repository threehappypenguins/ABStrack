import {
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
  type EpisodeMediaRow,
  type MediaType,
  type Uuid,
} from '@abstrack/types';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const EPISODE_MEDIA_BUCKET = 'episode-media';
const VIDEO_MAX_DURATION_SECONDS = Math.floor(
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS / 1000,
);

/**
 * True when `key` is a bucket-relative object path suitable for Storage `remove` on `episode-media`
 * (not a full URL, app `storage:` URI, leading `/`, or `episode-media/...` prefix — the bucket is
 * already selected on the client).
 */
function isBucketRelativeObjectKeyForRemove(key: string): boolean {
  const k = key.trim();
  if (!k) {
    return false;
  }
  if (k.includes('://')) {
    return false;
  }
  const lower = k.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return false;
  }
  if (lower.startsWith('storage:')) {
    return false;
  }
  if (k.startsWith('/')) {
    return false;
  }
  if (k.startsWith(`${EPISODE_MEDIA_BUCKET}/`)) {
    return false;
  }
  // Reject Storage API route paths (relative or accidentally stripped absolute paths).
  if (/^storage\/v\d+\//i.test(k)) {
    return false;
  }
  return true;
}

/**
 * Expands mistaken persisted shapes (URLs, `storage:`, bucket prefix, leading slashes) into
 * candidate object keys, then returns **only** values safe for `storage.from(bucket).remove(...)`.
 *
 * For Supabase Storage URLs (`/object/...` and `/render/image/...`), the bucket segment in the URL
 * must equal `episode-media`; otherwise URL-derived candidates are ignored so a mis-persisted link
 * to another bucket cannot normalize to a key that would delete under `episode-media`.
 */
function normalizeStoragePath(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [];
  }

  const candidateSet = new Set<string>([trimmed]);
  let normalized = trimmed;

  if (normalized.startsWith('storage:')) {
    normalized = normalized.slice('storage:'.length);
    candidateSet.add(normalized);
  }
  if (normalized.startsWith('/')) {
    normalized = normalized.replace(/^\/+/, '');
    candidateSet.add(normalized);
  }

  // Handle values that accidentally persisted with bucket prefix.
  const bucketPrefix = `${EPISODE_MEDIA_BUCKET}/`;
  if (normalized.startsWith(bucketPrefix)) {
    normalized = normalized.slice(bucketPrefix.length);
    candidateSet.add(normalized);
  }

  // Handle full URLs or Storage API URLs persisted by mistake.
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    try {
      const url = new URL(normalized);
      const pathname = url.pathname.replace(/^\/+/, '');
      const objectPathMatch = pathname.match(
        /\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
      );
      if (objectPathMatch?.[1] && objectPathMatch[2]) {
        const urlBucket = decodeURIComponent(objectPathMatch[1]);
        if (urlBucket === EPISODE_MEDIA_BUCKET) {
          candidateSet.add(decodeURIComponent(objectPathMatch[2]));
        }
      }
      // `/render/image/{public|authenticated|sign}/{bucket}/object-key-inside-bucket…`
      // (not `/render/image/{visibility}/rest` — that wrongly kept `episode-media/…` in the capture).
      const renderPathMatch = pathname.match(
        /\/render\/image\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/,
      );
      if (renderPathMatch?.[1] && renderPathMatch[2]) {
        const urlBucket = decodeURIComponent(renderPathMatch[1]);
        if (urlBucket === EPISODE_MEDIA_BUCKET) {
          let key = decodeURIComponent(renderPathMatch[2]);
          if (key.startsWith(bucketPrefix)) {
            key = key.slice(bucketPrefix.length);
          }
          candidateSet.add(key);
        }
      }
    } catch {
      // Ignore malformed URL strings and keep best-effort candidates.
    }
  }
  // Handle relative Storage API paths persisted by mistake, e.g.:
  // - /storage/v1/object/public/episode-media/u/ep/a.jpg
  // - storage/v1/render/image/public/episode-media/u/ep/a.jpg
  if (normalized.startsWith('storage/v')) {
    const objectPathMatch = normalized.match(
      /^storage\/v\d+\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (objectPathMatch?.[1] && objectPathMatch[2]) {
      const urlBucket = decodeURIComponent(objectPathMatch[1]);
      if (urlBucket === EPISODE_MEDIA_BUCKET) {
        candidateSet.add(decodeURIComponent(objectPathMatch[2]));
      }
    }
    const renderPathMatch = normalized.match(
      /^storage\/v\d+\/render\/image\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/,
    );
    if (renderPathMatch?.[1] && renderPathMatch[2]) {
      const urlBucket = decodeURIComponent(renderPathMatch[1]);
      if (urlBucket === EPISODE_MEDIA_BUCKET) {
        let key = decodeURIComponent(renderPathMatch[2]);
        if (key.startsWith(bucketPrefix)) {
          key = key.slice(bucketPrefix.length);
        }
        candidateSet.add(key);
      }
    }
  }

  return [...candidateSet]
    .map((v) => v.trim())
    .filter(Boolean)
    .filter(isBucketRelativeObjectKeyForRemove);
}

/**
 * Normalizes optional `storage:…` / DB-shaped strings into deduped bucket-relative keys suitable for
 * {@link removeEpisodeMediaStorageObjectPathsBestEffort} (same rules as listing from `episode_media`).
 *
 * @param rawCandidates - Primary and thumbnail refs from UI state or elsewhere.
 * @returns Deduped paths safe for `episode-media` `remove`.
 */
export function normalizedEpisodeMediaBucketKeysFromHints(
  rawCandidates: (string | null | undefined)[],
): string[] {
  const keys = new Set<string>();
  for (const raw of rawCandidates) {
    if (raw == null) {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    for (const normalized of normalizeStoragePath(trimmed)) {
      keys.add(normalized);
    }
  }
  return [...keys];
}

/**
 * RFC 4122 UUID v4 for Storage object keys via Web Crypto `getRandomValues` (cryptographically
 * secure once engines/polyfills expose it — browsers and Node provide `crypto`; React Native needs
 * `react-native-get-random-values` imported first at app startup).
 */
function uuidV4FromGetRandomValues(
  getRandomValues: (array: ArrayBufferView) => ArrayBufferView,
): string {
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * UUID v4 for filenames using Web Crypto only (`randomUUID` or `getRandomValues`).
 *
 * @throws {@link PresetDataError} when neither API exists — avoids invisible weak randomness.
 */
function randomUuidV4ForObjectKey(): string {
  const c = globalThis.crypto as
    | {
        randomUUID?: () => string;
        getRandomValues?: (array: ArrayBufferView) => ArrayBufferView;
      }
    | undefined;

  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }

  if (typeof c?.getRandomValues === 'function') {
    return uuidV4FromGetRandomValues(c.getRandomValues.bind(c));
  }

  throw new PresetDataError(
    'unknown',
    'Secure media upload is unavailable on this device right now. Please update or restart the app and try again.',
    {
      debugHint:
        'Web Crypto is missing. On React Native, import react-native-get-random-values at the top of your entry file (e.g. index.js) before other imports.',
    },
  );
}

/**
 * Upload body accepted by Supabase Storage for confirmed episode media.
 */
export type EpisodeMediaUploadBody =
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | Buffer
  | File
  | ReadableStream<Uint8Array>
  | string;

/**
 * Single filename extension segment safe for Storage object keys: letters and digits only (no path
 * separators, URL/query junk, or multi-part extensions after normalization).
 */
const FILENAME_EXTENSION_SAFE = /^[a-z0-9]+$/;

/**
 * Builds a private Storage object key under the required `{user_id}/...` prefix.
 *
 * @param args - Key parts used by storage/object RLS and episode media linkage.
 * @returns Object key for the `episode-media` bucket.
 */
export function createEpisodeMediaObjectKey(args: {
  userId: Uuid;
  episodeId: Uuid;
  mediaType: MediaType;
  extension: string;
}): string {
  const normalized =
    args.extension.trim().replace(/^\.+/, '').toLowerCase() || '';
  const ext =
    normalized && FILENAME_EXTENSION_SAFE.test(normalized) ? normalized : 'bin';
  const typePrefix = args.mediaType === 'photo' ? 'photo' : 'video';
  return `${args.userId}/${args.episodeId}/${typePrefix}-${randomUuidV4ForObjectKey()}.${ext}`;
}

/**
 * Builds a private Storage object key for a JPEG thumbnail under `{user_id}/{episode_id}/…`.
 * Thumbnails live in the same bucket and path-prefix model as primary media so Storage RLS applies
 * uniformly.
 *
 * @param args - User and episode identifiers (must match the primary object’s prefix).
 * @returns Object key for the `episode-media` bucket (always `.jpg`).
 */
export function createEpisodeMediaThumbnailObjectKey(args: {
  userId: Uuid;
  episodeId: Uuid;
}): string {
  return `${args.userId}/${args.episodeId}/thumb-${randomUuidV4ForObjectKey()}.jpg`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function httpStatusFromStorageError(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const raw = error.statusCode ?? error.status;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Maps Storage `upload` errors to user-facing copy. Transport failures often reuse the same “network”
 * messaging as PostgREST, but photo/video uploads are a separate HTTP path—callers should not imply
 * the whole app is offline.
 *
 * @param error - Value from `StorageUploadResponse.error`.
 */
function mapEpisodeMediaStorageUploadError(error: unknown): PresetDataError {
  const status = httpStatusFromStorageError(error);
  if (status === 401 || status === 403) {
    return new PresetDataError(
      'permission_denied',
      'You do not have permission to upload media for this episode.',
      {
        sourceError: error,
        debugHint:
          'Storage upload returned 401/403. Verify episode-media bucket/RLS policies allow uploads under the caller user path.',
      },
    );
  }
  if (status === 413) {
    return new PresetDataError(
      'validation_error',
      'That media file is too large to upload. Try a shorter clip or smaller photo.',
      error,
    );
  }
  if (status === 507) {
    return new PresetDataError(
      'unknown',
      'Upload could not be saved — media storage may be full or temporarily unable to accept files. Try again later.',
      error,
    );
  }
  if (status != null && status >= 400 && status < 500) {
    const msg =
      isRecord(error) && typeof error.message === 'string'
        ? error.message.trim()
        : '';
    return new PresetDataError(
      'unknown',
      msg !== '' ? `Media upload failed: ${msg}` : 'Media upload failed.',
      error,
    );
  }
  if (status != null && status >= 500) {
    return new PresetDataError(
      'unknown',
      'Media storage is temporarily unavailable. Try again shortly.',
      error,
    );
  }

  const mapped = toPresetDataError(error);
  if (mapped.code === 'network_error') {
    return new PresetDataError(
      'network_error',
      'We could not upload your media right now. Please check your connection and try again.',
      {
        sourceError: error,
        debugHint:
          'Storage upload hit a transport/network failure. If this persists, verify episode-media bucket/RLS rules and client network setup.',
      },
    );
  }
  return mapped;
}

/**
 * Best-effort delete of Storage objects under `episode-media` (e.g. rollback new upload after DB
 * failure, or delete superseded object after metadata update). Never throws: rejects, thrown
 * transport/SDK failures, and other surprises from `remove` are ignored so primary errors still
 * surface to callers. Non-throwing Storage `error` responses are ignored as well.
 */
async function removeBucketObjectsBestEffort(
  client: AbstrackSupabaseClient,
  keys: string[],
): Promise<void> {
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return;
  }
  try {
    const { error } = await client.storage
      .from(EPISODE_MEDIA_BUCKET)
      .remove(unique);
    void error;
  } catch {
    // Intentionally empty — rollback cleanup must not replace or mask the caller's primary outcome.
  }
}

/**
 * After a new symptom-linked `episode_media` insert, deletes other `episode_symptoms` rows for the
 * same preset line in the **current open pass** (same `created_at` filter as
 * `deleteCurrentPassEpisodeSymptomAnswer`), then best-effort removes their Storage keys listed from
 * `episode_media` **before** delete (`episode_media` CASCADE removes metadata). Keeps the canonical
 * symptom row only. Deletes DB rows before Storage so failed deletes do not orphan metadata pointing
 * at already-removed objects.
 *
 * @param client - Supabase client (RLS applies).
 * @param args - Episode, preset line, canonical symptom row id, and pass boundary (or null).
 * @returns PostgREST-shaped `{ data, error }` for use inside `wrap`. When called from
 * `uploadConfirmedEpisodeMedia`, failures are treated as best-effort (not returned to the caller as
 * upload failure).
 */
async function deleteSupersededOpenPassEpisodeSymptomsAndTheirEpisodeMedia(
  client: AbstrackSupabaseClient,
  args: {
    episodeId: Uuid;
    presetSymptomId: Uuid;
    keepEpisodeSymptomId: Uuid;
    lastPostMarkerStepCompletedAt: string | null;
  },
): Promise<{ data: true | null; error: unknown }> {
  let symptomQuery = client
    .from('episode_symptoms')
    .select('id')
    .eq('episode_id', args.episodeId)
    .eq('preset_symptom_id', args.presetSymptomId)
    .neq('id', args.keepEpisodeSymptomId);

  if (args.lastPostMarkerStepCompletedAt != null) {
    symptomQuery = symptomQuery.gt(
      'created_at',
      args.lastPostMarkerStepCompletedAt,
    );
  }

  const { data: obsolete, error: selErr } = await symptomQuery;
  if (selErr) {
    return { data: null, error: selErr };
  }

  const obsoleteIds = (obsolete ?? [])
    .map((row: { id: string }) => row.id)
    .filter(Boolean);
  if (obsoleteIds.length === 0) {
    return { data: true, error: null };
  }

  const { data: mediaRows, error: mediaErr } = await client
    .from('episode_media')
    .select('storage_object_key, thumbnail_storage_key')
    .in('episode_symptom_id', obsoleteIds);

  if (mediaErr) {
    return { data: null, error: mediaErr };
  }

  const keysToRemove = new Set<string>();
  for (const raw of mediaRows ?? []) {
    const row = raw as {
      storage_object_key: string;
      thumbnail_storage_key: string | null;
    };
    for (const k of normalizeStoragePath(row.storage_object_key ?? '')) {
      keysToRemove.add(k);
    }
    for (const k of normalizeStoragePath(row.thumbnail_storage_key ?? '')) {
      keysToRemove.add(k);
    }
  }

  const { error: delErr } = await client
    .from('episode_symptoms')
    .delete()
    .in('id', obsoleteIds);

  if (delErr) {
    return { data: null, error: delErr };
  }

  await removeBucketObjectsBestEffort(client, [...keysToRemove]);
  return { data: true, error: null };
}

/**
 * Uploads a confirmed media object to private Storage and persists/updates its `episode_media` row.
 * Sets `upload_completed_at` only after the Storage upload succeeds (not before the HTTP upload).
 * If the DB write fails after upload, removes the newly uploaded object from Storage. On update,
 * removes the previous `storage_object_key` from Storage after the row update succeeds (when it
 * differed from the new key), using {@link normalizeStoragePath} so legacy persisted shapes (URLs,
 * `storage:`, bucket prefix) still resolve to bucket-relative paths for `remove`.
 *
 * The row is linked to one `episode_symptoms` record so symptom history and media metadata stay in
 * sync. If a row already exists for this `episode_symptom_id`, it is updated in place.
 *
 * When `supersedeOpenPassPresetSymptomAnswers` is set and this call **inserts** a new
 * `episode_media` row (retake after “record again” / “take photo again”), a **best-effort** pass
 * removes older open-pass `episode_symptoms` rows for that preset line and deletes their Storage
 * objects so prior uploads are less likely to orphan. Cleanup errors are **not** surfaced as
 * `{ ok: false }` once the new row exists: the primary outcome remains success so callers still
 * patch UI to `storage:...` and avoid duplicate retries that would add more blobs/rows.
 *
 * @param client - Supabase client (RLS applies to Storage and table writes).
 * @param args - Upload payload + relational linkage identifiers.
 * @param args.thumbnail - Optional second object (typically a JPEG) uploaded next to the primary
 *   asset; when provided, {@link createEpisodeMediaThumbnailObjectKey} assigns the Storage path and
 *   `episode_media.thumbnail_storage_key` is set. Omit only in tests or transitional callers —
 *   production clients should supply a thumbnail for photo/video so grids can load small previews
 *   with the same authorization boundary as the primary object.
 * @returns The created/updated `episode_media` row, or `{ ok: false }` on validation, Web Crypto,
 *   Storage, or database errors. Does not throw: missing `crypto`, Storage `upload` rejections, or
 *   thrown transport/SDK failures are returned as `{ ok: false }` (use `react-native-get-random-values` on RN).
 */
export async function uploadConfirmedEpisodeMedia(
  client: AbstrackSupabaseClient,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    episodeSymptomId: Uuid;
    mediaType: MediaType;
    body: EpisodeMediaUploadBody;
    contentType: string;
    extension: string;
    durationSeconds?: number | null;
    /**
     * JPEG or other preview bytes uploaded under {@link createEpisodeMediaThumbnailObjectKey}.
     */
    thumbnail?: {
      body: EpisodeMediaUploadBody;
      contentType: string;
      /**
       * Filename extension for MIME alignment (thumbnails are usually `jpg` / `image/jpeg`).
       */
      extension?: string;
    };
    /**
     * When present, after a successful **new** `episode_media` insert, runs best-effort cleanup of
     * superseded open-pass symptom rows for this preset and their bucket objects (cleanup failures
     * do not fail the upload result).
     */
    supersedeOpenPassPresetSymptomAnswers?: {
      presetSymptomId: Uuid;
      /** Same semantics as skip/delete symptom: null = entire episode history for the line. */
      lastPostMarkerStepCompletedAt: string | null;
    };
  },
): Promise<PresetDataResult<EpisodeMediaRow>> {
  if (!args.contentType.trim()) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Media upload content type is required.',
      ),
    };
  }

  if (args.thumbnail != null && !args.thumbnail.contentType.trim()) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Thumbnail content type is required.',
      ),
    };
  }

  let objectKey: string;
  try {
    objectKey = createEpisodeMediaObjectKey({
      userId: args.userId,
      episodeId: args.episodeId,
      mediaType: args.mediaType,
      extension: args.extension,
    });
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }

  let thumbnailKey: string | null = null;
  if (args.thumbnail != null) {
    try {
      thumbnailKey = createEpisodeMediaThumbnailObjectKey({
        userId: args.userId,
        episodeId: args.episodeId,
      });
    } catch (caught) {
      return { ok: false, error: toPresetDataError(caught) };
    }
  }

  const durationSeconds =
    args.mediaType === 'video' && args.durationSeconds != null
      ? Math.max(
          1,
          Math.min(
            VIDEO_MAX_DURATION_SECONDS,
            Math.trunc(args.durationSeconds),
          ),
        )
      : null;

  let uploaded;
  try {
    uploaded = await client.storage
      .from(EPISODE_MEDIA_BUCKET)
      .upload(objectKey, args.body, {
        contentType: args.contentType,
        upsert: false,
      });
  } catch (caught) {
    return {
      ok: false,
      error: mapEpisodeMediaStorageUploadError(caught),
    };
  }
  if (uploaded.error) {
    return {
      ok: false,
      error: mapEpisodeMediaStorageUploadError(uploaded.error),
    };
  }

  if (args.thumbnail != null && thumbnailKey != null) {
    const thumbContentType = args.thumbnail.contentType.trim();
    let thumbUploaded;
    try {
      thumbUploaded = await client.storage
        .from(EPISODE_MEDIA_BUCKET)
        .upload(thumbnailKey, args.thumbnail.body, {
          contentType: thumbContentType,
          upsert: false,
        });
    } catch (caught) {
      await removeBucketObjectsBestEffort(client, [objectKey]);
      return {
        ok: false,
        error: mapEpisodeMediaStorageUploadError(caught),
      };
    }
    if (thumbUploaded.error) {
      await removeBucketObjectsBestEffort(client, [objectKey]);
      return {
        ok: false,
        error: mapEpisodeMediaStorageUploadError(thumbUploaded.error),
      };
    }
  }

  /** After Storage succeeds so ordering/UX reflect real completion, not queue start. */
  const uploadCompletedAt = new Date().toISOString();

  const freshBlobKeys = [
    objectKey,
    ...(thumbnailKey != null ? [thumbnailKey] : []),
  ];

  return wrap(async () => {
    const existing = await client
      .from('episode_media')
      .select('id, storage_object_key, thumbnail_storage_key')
      .eq('episode_id', args.episodeId)
      .eq('episode_symptom_id', args.episodeSymptomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      await removeBucketObjectsBestEffort(client, freshBlobKeys);
      return {
        data: null,
        error: existing.error,
      };
    }

    if (existing.data?.id) {
      const previousKeyRaw = existing.data.storage_object_key;
      const previousKey =
        typeof previousKeyRaw === 'string' ? previousKeyRaw.trim() : '';
      const previousThumbRaw = existing.data.thumbnail_storage_key;
      const previousThumb =
        typeof previousThumbRaw === 'string' ? previousThumbRaw.trim() : '';
      const updated = await client
        .from('episode_media')
        .update({
          storage_object_key: objectKey,
          thumbnail_storage_key: thumbnailKey,
          media_type: args.mediaType,
          duration_seconds: durationSeconds,
          upload_completed_at: uploadCompletedAt,
        })
        .eq('id', existing.data.id)
        .select('*')
        .single();
      if (updated.error) {
        await removeBucketObjectsBestEffort(client, freshBlobKeys);
        return {
          data: null,
          error: updated.error,
        };
      }
      if (previousKey !== '' && previousKey !== objectKey) {
        const keysToRemove = normalizeStoragePath(previousKey).filter(
          (k) => k !== objectKey,
        );
        await removeBucketObjectsBestEffort(client, keysToRemove);
      }
      const nextThumb = thumbnailKey ?? '';
      if (previousThumb !== '' && previousThumb !== nextThumb) {
        const keysToRemove = normalizeStoragePath(previousThumb).filter(
          (k) => k !== nextThumb,
        );
        await removeBucketObjectsBestEffort(client, keysToRemove);
      }
      return {
        data: updated.data as EpisodeMediaRow | null,
        error: updated.error,
      };
    }

    const inserted = await client
      .from('episode_media')
      .insert({
        user_id: args.userId,
        episode_id: args.episodeId,
        episode_symptom_id: args.episodeSymptomId,
        storage_object_key: objectKey,
        thumbnail_storage_key: thumbnailKey,
        media_type: args.mediaType,
        duration_seconds: durationSeconds,
        upload_completed_at: uploadCompletedAt,
      })
      .select('*')
      .single();
    if (inserted.error) {
      await removeBucketObjectsBestEffort(client, freshBlobKeys);
      return {
        data: null,
        error: inserted.error,
      };
    }

    const supersede = args.supersedeOpenPassPresetSymptomAnswers;
    if (supersede) {
      await deleteSupersededOpenPassEpisodeSymptomsAndTheirEpisodeMedia(
        client,
        {
          episodeId: args.episodeId,
          presetSymptomId: supersede.presetSymptomId,
          keepEpisodeSymptomId: args.episodeSymptomId,
          lastPostMarkerStepCompletedAt:
            supersede.lastPostMarkerStepCompletedAt,
        },
      );
    }

    return {
      data: inserted.data as EpisodeMediaRow | null,
      error: inserted.error,
    };
  });
}

/**
 * Columns returned by {@link listEpisodeMediaForEpisode} for symptom hydration (minimal payload vs
 * `select('*')` on large histories).
 */
export type EpisodeMediaListRow = Pick<
  EpisodeMediaRow,
  | 'episode_symptom_id'
  | 'storage_object_key'
  | 'thumbnail_storage_key'
  | 'upload_completed_at'
  | 'duration_seconds'
>;

/**
 * Lists media rows for one episode, newest first (`created_at`, then `id`).
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @param options - Optional `episodeSymptomIds` filter (canonical open-pass `episode_symptoms.id`
 *   values) to avoid loading unrelated historical `episode_media` rows.
 * @returns Narrow projection suitable for symptom prompt hydration.
 */
export async function listEpisodeMediaForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  options?: {
    episodeSymptomIds?: Uuid[];
  },
): Promise<PresetDataResult<EpisodeMediaListRow[]>> {
  return wrap(async () => {
    const ids = options?.episodeSymptomIds;
    if (ids !== undefined && ids.length === 0) {
      return { data: [], error: null };
    }

    let query = client
      .from('episode_media')
      .select(
        'episode_symptom_id, storage_object_key, thumbnail_storage_key, upload_completed_at, duration_seconds',
      )
      .eq('episode_id', episodeId);

    if (ids !== undefined && ids.length > 0) {
      query = query.in('episode_symptom_id', ids);
    }

    const r = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    return {
      data: (r.data ?? []) as EpisodeMediaListRow[],
      error: r.error,
    };
  });
}

/**
 * Reads `episode_media` keys for an episode and returns deduped, bucket-relative Storage paths
 * (same normalization as `removeEpisodeMediaObjectsFromStorage`). Call while the episode row still
 * exists so metadata is available for listing.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @returns Normalized object paths suitable for `episode-media` `remove`, or an error when the
 *   metadata query fails.
 */
/**
 * Lists normalized bucket-relative paths for `episode_media` rows tied to specific symptom-step
 * rows (primary + thumbnail keys). Used before deleting those symptom rows so Storage objects can be
 * removed after Postgres CASCADE clears metadata.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @param episodeSymptomIds - `episode_symptoms.id` values whose media should be listed.
 */
export async function listEpisodeMediaBucketPathsForEpisodeSymptomIds(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  episodeSymptomIds: Uuid[],
): Promise<PresetDataResult<string[]>> {
  try {
    if (episodeSymptomIds.length === 0) {
      return { ok: true, data: [] };
    }
    const { data: rows, error } = await client
      .from('episode_media')
      .select('storage_object_key, thumbnail_storage_key')
      .eq('episode_id', episodeId)
      .in('episode_symptom_id', episodeSymptomIds);

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    const keys = new Set<string>();
    for (const raw of rows ?? []) {
      const row = raw as {
        storage_object_key: string;
        thumbnail_storage_key: string | null;
      };
      for (const normalized of normalizeStoragePath(
        row.storage_object_key ?? '',
      )) {
        keys.add(normalized);
      }
      for (const normalized of normalizeStoragePath(
        row.thumbnail_storage_key ?? '',
      )) {
        keys.add(normalized);
      }
    }
    return { ok: true, data: [...keys] };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

export async function listEpisodeMediaStorageObjectPathsForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<string[]>> {
  try {
    const { data: rows, error } = await client
      .from('episode_media')
      .select('storage_object_key, thumbnail_storage_key')
      .eq('episode_id', episodeId);

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    const keys = new Set<string>();
    for (const raw of rows ?? []) {
      const row = raw as {
        storage_object_key: string;
        thumbnail_storage_key: string | null;
      };
      for (const normalized of normalizeStoragePath(
        row.storage_object_key ?? '',
      )) {
        keys.add(normalized);
      }
      for (const normalized of normalizeStoragePath(
        row.thumbnail_storage_key ?? '',
      )) {
        keys.add(normalized);
      }
    }
    return { ok: true, data: [...keys] };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Best-effort Storage delete for paths previously listed for an episode (e.g. after the `episodes`
 * row was removed). Never throws; failures are ignored so callers can treat the DB delete as
 * authoritative.
 *
 * @param client - Supabase client (RLS applies to Storage DELETE).
 * @param paths - Bucket-relative keys under `episode-media`.
 */
export async function removeEpisodeMediaStorageObjectPathsBestEffort(
  client: AbstrackSupabaseClient,
  paths: string[],
): Promise<void> {
  await removeBucketObjectsBestEffort(client, paths);
}

export type RemoveEpisodeMediaObjectsFromStorageResult =
  | { ok: true }
  | { ok: false; error: PresetDataError };

/**
 * Lists `episode_media` keys, then removes those objects from private Storage. Fails when listing
 * or Storage `remove` returns an error (strict). For episode lifecycle deletes that must not drop
 * blobs before Postgres commits, prefer `listEpisodeMediaStorageObjectPathsForEpisode` → delete
 * episode → `removeEpisodeMediaStorageObjectPathsBestEffort` (as in `cancelActiveEpisodeById` /
 * `deleteEpisodeById` in `episode-data.ts`).
 *
 * @param client - Supabase client (RLS applies to Storage DELETE).
 * @param episodeId - `episodes.id`.
 */
export async function removeEpisodeMediaObjectsFromStorage(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<RemoveEpisodeMediaObjectsFromStorageResult> {
  const listed = await listEpisodeMediaStorageObjectPathsForEpisode(
    client,
    episodeId,
  );
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  if (listed.data.length === 0) {
    return { ok: true };
  }
  try {
    const removed = await client.storage
      .from(EPISODE_MEDIA_BUCKET)
      .remove(listed.data);
    if (removed.error) {
      return {
        ok: false,
        error: toPresetDataError(removed.error),
      };
    }
    return { ok: true };
  } catch (caught) {
    return {
      ok: false,
      error: toPresetDataError(caught),
    };
  }
}
