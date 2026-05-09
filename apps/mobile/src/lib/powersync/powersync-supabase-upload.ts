import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  listEpisodeMediaBucketPathsForEpisodeMediaId,
  listEpisodeMediaBucketPathsForEpisodeSymptomId,
  removeEpisodeMediaStorageObjectPathsBestEffort,
} from '@abstrack/supabase';
import type {
  AbstractPowerSyncDatabase,
  CrudBatch,
  CrudEntry,
} from '@powersync/react-native';
import { UpdateType } from '@powersync/react-native';

type PowerSyncHandleCrudCheckpoint = (
  lastClientId: number,
  writeCheckpoint?: string,
) => Promise<void>;

/**
 * Exact `@powersync/react-native` version this upload path was last verified against. Must match
 * `apps/mobile/package.json` — bump **with** {@link POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON} in one PR after
 * confirming `handleCrudCheckpoint` still exists at runtime (dev-time warning in this module when versions drift).
 */
export const POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE = '1.34.0';

/**
 * Exact `@powersync/common` peer used by the React Native SDK. Same bump rules as
 * {@link POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE}.
 */
export const POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON = '1.52.0';

let uploadContractWarningEmitted = false;

/**
 * In Metro dev builds, logs once when installed PowerSync package versions differ from the pins above
 * (no type-level signal when a private method disappears). Production stays quiet.
 */
function warnIfPowerSyncSdkDriftsFromUploadContract(): void {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDev || uploadContractWarningEmitted) {
    return;
  }
  uploadContractWarningEmitted = true;
  try {
    const rnPkg = require('@powersync/react-native/package.json') as {
      version?: string;
    };
    const commonPkg = require('@powersync/common/package.json') as {
      version?: string;
    };
    const rn = rnPkg.version;
    const common = commonPkg.version;
    if (
      rn !== POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE ||
      common !== POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON
    ) {
      console.warn(
        '[PowerSync upload] Installed @powersync/react-native or @powersync/common differs from ABStrack upload pins. Incremental dequeue uses private `handleCrudCheckpoint`; verify uploads after bumping, then update POWERSYNC_UPLOAD_RUNTIME_PIN_* in powersync-supabase-upload.ts.',
        {
          reactNative: rn,
          common,
          expectedReactNative: POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE,
          expectedCommon: POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON,
        },
      );
    }
  } catch {
    // Metro may omit package.json from the graph in some configs — skip quietly.
  }
}

/**
 * Resolves PowerSync's internal CRUD dequeue helper used by {@link CrudBatch#complete}.
 *
 * The method is present at runtime on {@link AbstractPowerSyncDatabase} but not part of the public
 * `.d.ts` surface (private / omitted), so it is accessed via a narrow cast. Keep
 * {@link POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE} / {@link POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON} aligned with
 * `apps/mobile/package.json` and re-verify uploads after any PowerSync upgrade.
 *
 * @param database - PowerSync DB passed into {@link PowerSyncBackendConnector#uploadData}.
 * @returns Function that deletes local CRUD queue rows through `lastClientId` (same as batch complete).
 */
function resolvePowerSyncHandleCrudCheckpoint(
  database: AbstractPowerSyncDatabase,
): (lastClientId: number) => Promise<void> {
  const checkpoint = (
    database as unknown as {
      handleCrudCheckpoint?: PowerSyncHandleCrudCheckpoint;
    }
  ).handleCrudCheckpoint;
  if (typeof checkpoint !== 'function') {
    throw new Error(
      `PowerSync database is missing handleCrudCheckpoint (private API on AbstractPowerSyncDatabase). ` +
        `Incremental uploads cannot dequeue after partial batch progress. ` +
        `Expected pins: @powersync/react-native ${POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE}, ` +
        `@powersync/common ${POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON} — bump those constants after you verify a newer SDK still exposes this method, or refactor uploads to a public checkpoint API if PowerSync adds one.`,
    );
  }
  return (lastClientId) => checkpoint.call(database, lastClientId);
}

/**
 * Converts SQLite-stored values into shapes PostgREST accepts on upsert/update.
 *
 * @param table - Replicated table name (matches `public` and PowerSync schema).
 * @param row - Column map from {@link CrudEntry} data plus `id`.
 */
export function normalizePowerSyncRowForSupabase(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  if (table === 'episode_symptoms' && 'response_boolean' in out) {
    const v = out.response_boolean;
    if (v === 0 || v === 1) {
      out.response_boolean = v === 1;
    }
  }
  return out;
}

type ExecuteCapablePowerSyncDatabase = AbstractPowerSyncDatabase & {
  execute: (sql: string, params?: unknown[]) => Promise<void>;
};

type SqlReadWriteCapablePowerSyncDatabase = ExecuteCapablePowerSyncDatabase & {
  getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
};

function isExecuteCapablePowerSyncDatabase(
  database: AbstractPowerSyncDatabase | null | undefined,
): database is ExecuteCapablePowerSyncDatabase {
  return (
    database != null &&
    typeof (database as { execute?: unknown }).execute === 'function'
  );
}

function isSqlReadWriteCapablePowerSyncDatabase(
  database: AbstractPowerSyncDatabase | null | undefined,
): database is SqlReadWriteCapablePowerSyncDatabase {
  return (
    isExecuteCapablePowerSyncDatabase(database) &&
    typeof (database as { getAll?: unknown }).getAll === 'function'
  );
}

/**
 * Stable row id for `pending_episode_media_storage_cleanup` so persistence uses a single
 * `INSERT OR REPLACE` (atomic in SQLite) instead of DELETE-then-INSERT, which could lose the queue row
 * if the app crashed between those two statements.
 *
 * @param targetKind - Parent table whose remote row was deleted.
 * @param targetId - Remote row id.
 * @returns Primary key string stored in the cleanup table's `id` column.
 */
function pendingEpisodeMediaStorageCleanupRowId(
  targetKind: 'episode_symptoms' | 'episode_media',
  targetId: string,
): string {
  return `pemsc:${targetKind}:${targetId}`;
}

/**
 * Persists bucket-relative paths **after** the matching PostgREST DELETE succeeds so a crash before
 * {@link removeEpisodeMediaStorageObjectPathsBestEffort} can still complete Storage cleanup on the next
 * {@link drainPendingEpisodeMediaStorageCleanupQueue} run (retries can no longer list paths once CASCADE
 * removed `episode_media`). Rows live in the local-only `pending_episode_media_storage_cleanup` table.
 */
async function persistEpisodeMediaStorageCleanupPlanAfterRemoteDelete(
  database: ExecuteCapablePowerSyncDatabase,
  args: {
    targetKind: 'episode_symptoms' | 'episode_media';
    targetId: string;
    paths: string[];
  },
): Promise<void> {
  await database.execute(
    `INSERT OR REPLACE INTO pending_episode_media_storage_cleanup (id, storage_paths_json, target_kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    [
      pendingEpisodeMediaStorageCleanupRowId(args.targetKind, args.targetId),
      JSON.stringify(args.paths),
      args.targetKind,
      args.targetId,
      new Date().toISOString(),
    ],
  );
}

/**
 * Drops the durable cleanup plan for `targetKind`/`targetId` after Storage `remove` succeeds.
 *
 * @param database - PowerSync SQLite handle.
 * @param targetKind - Which parent row was deleted on the server.
 * @param targetId - Server row id (symptom or `episode_media` id).
 */
async function clearEpisodeMediaStorageCleanupPlan(
  database: ExecuteCapablePowerSyncDatabase,
  targetKind: 'episode_symptoms' | 'episode_media',
  targetId: string,
): Promise<void> {
  await database.execute(
    `DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?`,
    [pendingEpisodeMediaStorageCleanupRowId(targetKind, targetId)],
  );
}

/**
 * Best-effort drain of the local-only `pending_episode_media_storage_cleanup` SQLite queue. No-op when
 * `database` is missing SQL helpers (Jest doubles).
 *
 * @param client - Supabase client for Storage `remove`.
 * @param database - PowerSync database handle from the upload connector.
 */
export async function drainPendingEpisodeMediaStorageCleanupQueue(
  client: AbstrackSupabaseClient,
  database: AbstractPowerSyncDatabase,
): Promise<void> {
  if (!isSqlReadWriteCapablePowerSyncDatabase(database)) {
    return;
  }
  const rows = await database.getAll<{
    id: string;
    storage_paths_json: string;
  }>(
    `SELECT id, storage_paths_json FROM pending_episode_media_storage_cleanup ORDER BY created_at ASC LIMIT 100`,
    [],
  );
  for (const row of rows) {
    let paths: string[];
    try {
      const parsed = JSON.parse(row.storage_paths_json) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('expected json array');
      }
      paths = parsed.filter(
        (p): p is string => typeof p === 'string' && p.trim() !== '',
      );
    } catch {
      await database.execute(
        `DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?`,
        [row.id],
      );
      continue;
    }
    if (paths.length === 0) {
      await database.execute(
        `DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?`,
        [row.id],
      );
      continue;
    }
    await removeEpisodeMediaStorageObjectPathsBestEffort(client, paths);
    await database.execute(
      `DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?`,
      [row.id],
    );
  }
}

/**
 * Applies one PowerSync CRUD entry to Supabase REST (RLS). {@link uploadPowerSyncCrudBatchToSupabase}
 * checkpoints after each entry; {@link CrudBatch#complete} runs on the success path in the backend connector.
 *
 * PATCH and DELETE use `select('id').maybeSingle()` so 0-row effects (replay, ordering, idempotent
 * deletes) do not return **PGRST116**, which is classified as a permanent API failure and would dequeue
 * ops incorrectly. For `episode_symptoms` / `episode_media`, bucket paths are listed first, then
 * PostgREST DELETE runs; **Storage** objects are removed only when the DELETE response includes a row
 * (`data` from `maybeSingle`) **and** listed paths were non-empty — so RLS “0 rows” or predicate
 * mismatch never deletes blobs for a row that may still exist (same intent as
 * {@link deleteCurrentPassEpisodeSymptomAnswer} ordering).
 *
 * After a successful symptom/media row delete with non-empty listed paths, paths are written to the
 * local-only `pending_episode_media_storage_cleanup` table **before** Storage `remove` so a crash between
 * DELETE and `remove` can still delete blobs on the next {@link drainPendingEpisodeMediaStorageCleanupQueue} run.
 * That matters especially for `episode_media`: after the row is deleted, a retry cannot re-list
 * `storage_object_key` / `thumbnail_storage_key` from PostgREST, so the queued JSON paths are the only
 * durable source for idempotent Storage cleanup.
 *
 * @param client - Authenticated Supabase client (user JWT).
 * @param entry - Local change from {@link CrudBatch}.
 * @param powerSyncDatabase - Optional PowerSync DB for durable Storage cleanup (omit in unit tests).
 */
export async function applyPowerSyncCrudEntryToSupabase(
  client: AbstrackSupabaseClient,
  entry: CrudEntry,
  powerSyncDatabase?: AbstractPowerSyncDatabase | null,
): Promise<void> {
  const table = entry.table;
  const id = entry.id;

  if (entry.op === UpdateType.PUT) {
    const merged = normalizePowerSyncRowForSupabase(table, {
      ...(entry.opData ?? {}),
      id,
    });
    const { error } = await client
      .from(table as never)
      .upsert(merged as never, { onConflict: 'id' });
    if (error) {
      throw error;
    }
    return;
  }

  if (entry.op === UpdateType.PATCH) {
    const patch = normalizePowerSyncRowForSupabase(table, entry.opData ?? {});
    const { error } = await client
      .from(table as never)
      .update(patch as never)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      throw error;
    }
    return;
  }

  if (entry.op === UpdateType.DELETE) {
    if (table === 'episode_symptoms') {
      const listed = await listEpisodeMediaBucketPathsForEpisodeSymptomId(
        client,
        id,
      );
      if (!listed.ok) {
        throw listed.error;
      }
      const { data: deletedSymptomRow, error } = await client
        .from('episode_symptoms')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (deletedSymptomRow == null) {
        return;
      }
      if (listed.data.length > 0) {
        if (isExecuteCapablePowerSyncDatabase(powerSyncDatabase)) {
          await persistEpisodeMediaStorageCleanupPlanAfterRemoteDelete(
            powerSyncDatabase,
            {
              targetKind: 'episode_symptoms',
              targetId: id,
              paths: listed.data,
            },
          );
        }
        await removeEpisodeMediaStorageObjectPathsBestEffort(
          client,
          listed.data,
        );
        if (isExecuteCapablePowerSyncDatabase(powerSyncDatabase)) {
          await clearEpisodeMediaStorageCleanupPlan(
            powerSyncDatabase,
            'episode_symptoms',
            id,
          );
        }
      }
      return;
    }
    if (table === 'episode_media') {
      const listed = await listEpisodeMediaBucketPathsForEpisodeMediaId(
        client,
        id,
      );
      if (!listed.ok) {
        throw listed.error;
      }
      const { data: deletedMediaRow, error } = await client
        .from('episode_media')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (deletedMediaRow == null) {
        return;
      }
      if (listed.data.length > 0) {
        if (isExecuteCapablePowerSyncDatabase(powerSyncDatabase)) {
          await persistEpisodeMediaStorageCleanupPlanAfterRemoteDelete(
            powerSyncDatabase,
            {
              targetKind: 'episode_media',
              targetId: id,
              paths: listed.data,
            },
          );
        }
        await removeEpisodeMediaStorageObjectPathsBestEffort(
          client,
          listed.data,
        );
        if (isExecuteCapablePowerSyncDatabase(powerSyncDatabase)) {
          await clearEpisodeMediaStorageCleanupPlan(
            powerSyncDatabase,
            'episode_media',
            id,
          );
        }
      }
      return;
    }

    const { error } = await client
      .from(table as never)
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      throw error;
    }
    return;
  }
}

/**
 * Uploads every {@link CrudEntry} in a {@link CrudBatch} to Supabase and dequeues each op from the
 * local upload queue **immediately after** its REST call succeeds.
 *
 * Applying every entry first and only then calling {@link CrudBatch#complete} would leave earlier,
 * already-applied ops on the queue when a later entry fails; the next upload attempt would replay
 * them (DELETE/PATCH “already gone” false failures). Incremental checkpointing matches PowerSync's
 * `DELETE FROM ps_crud WHERE id <= ?` semantics per applied prefix.
 *
 * @param client - Authenticated Supabase client.
 * @param batch - Non-empty batch from {@link AbstractPowerSyncDatabase#getCrudBatch}.
 * @param database - Same PowerSync database instance passed to {@link PowerSyncBackendConnector#uploadData}.
 */
export async function uploadPowerSyncCrudBatchToSupabase(
  client: AbstrackSupabaseClient,
  batch: CrudBatch,
  database: AbstractPowerSyncDatabase,
): Promise<void> {
  warnIfPowerSyncSdkDriftsFromUploadContract();
  await drainPendingEpisodeMediaStorageCleanupQueue(client, database);
  const dequeueThrough = resolvePowerSyncHandleCrudCheckpoint(database);
  for (const entry of batch.crud) {
    await applyPowerSyncCrudEntryToSupabase(client, entry, database);
    await dequeueThrough(entry.clientId);
  }
}
