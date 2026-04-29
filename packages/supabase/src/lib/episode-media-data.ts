import type { EpisodeMediaRow, MediaType, Uuid } from '@abstrack/types';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const EPISODE_MEDIA_BUCKET = 'episode-media';

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
  return true;
}

/**
 * Expands mistaken persisted shapes (URLs, `storage:`, bucket prefix, leading slashes) into
 * candidate object keys, then returns **only** values safe for `storage.from(bucket).remove(...)`.
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
        /\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/,
      );
      if (objectPathMatch?.[1]) {
        candidateSet.add(decodeURIComponent(objectPathMatch[1]));
      }
      const renderPathMatch = pathname.match(/\/render\/image\/[^/]+\/(.+)$/);
      if (renderPathMatch?.[1]) {
        candidateSet.add(decodeURIComponent(renderPathMatch[1]));
      }
    } catch {
      // Ignore malformed URL strings and keep best-effort candidates.
    }
  }

  return [...candidateSet]
    .map((v) => v.trim())
    .filter(Boolean)
    .filter(isBucketRelativeObjectKeyForRemove);
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
    'Secure randomness is unavailable (Web Crypto missing). On React Native import react-native-get-random-values at the very top of your entry file (e.g. index.js), before other imports.',
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
      'Media upload was refused (Storage). Check bucket policies for episode-media so your account can upload under your user path.',
      error,
    );
  }
  if (status === 413 || status === 507) {
    return new PresetDataError(
      'validation_error',
      'That media file is too large to upload. Try a shorter clip or smaller photo.',
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
      'Upload failed while sending the media file to Storage. Saving answers uses the database only—this step is file upload. Retry or verify Storage rules for the episode-media bucket.',
      error,
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
 * @param client - Supabase client (RLS applies to Storage and table writes).
 * @param args - Upload payload + relational linkage identifiers.
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

  const durationSeconds =
    args.mediaType === 'video' && args.durationSeconds != null
      ? Math.max(1, Math.min(15, Math.trunc(args.durationSeconds)))
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

  /** After Storage succeeds so ordering/UX reflect real completion, not queue start. */
  const uploadCompletedAt = new Date().toISOString();

  return wrap(async () => {
    const existing = await client
      .from('episode_media')
      .select('id, storage_object_key')
      .eq('episode_id', args.episodeId)
      .eq('episode_symptom_id', args.episodeSymptomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      await removeBucketObjectsBestEffort(client, [objectKey]);
      return {
        data: null,
        error: existing.error,
      };
    }

    if (existing.data?.id) {
      const previousKeyRaw = existing.data.storage_object_key;
      const previousKey =
        typeof previousKeyRaw === 'string' ? previousKeyRaw.trim() : '';
      const updated = await client
        .from('episode_media')
        .update({
          storage_object_key: objectKey,
          media_type: args.mediaType,
          duration_seconds: durationSeconds,
          upload_completed_at: uploadCompletedAt,
        })
        .eq('id', existing.data.id)
        .select('*')
        .single();
      if (updated.error) {
        await removeBucketObjectsBestEffort(client, [objectKey]);
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
        media_type: args.mediaType,
        duration_seconds: durationSeconds,
        upload_completed_at: uploadCompletedAt,
      })
      .select('*')
      .single();
    if (inserted.error) {
      await removeBucketObjectsBestEffort(client, [objectKey]);
      return {
        data: null,
        error: inserted.error,
      };
    }
    return {
      data: inserted.data as EpisodeMediaRow | null,
      error: inserted.error,
    };
  });
}

/**
 * Lists media rows for one episode, newest first.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @returns Media rows visible to the caller.
 */
export async function listEpisodeMediaForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<EpisodeMediaRow[]>> {
  return wrap(async () => {
    const r = await client
      .from('episode_media')
      .select('*')
      .eq('episode_id', episodeId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    return {
      data: (r.data ?? []) as EpisodeMediaRow[],
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
