import type { AbstrackSupabaseClient } from '@abstrack/supabase';
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

/**
 * Applies one PowerSync CRUD entry to Supabase REST (RLS). Caller completes the batch after success.
 *
 * PATCH and DELETE use PostgREST `select('id').single()` after `update` / `delete` so zero-row
 * effects (deleted row, RLS hiding the row, predicate mismatch) return an error instead of succeeding
 * silently before {@link CrudBatch#complete}.
 *
 * @param client - Authenticated Supabase client (user JWT).
 * @param entry - Local change from {@link CrudBatch}.
 */
export async function applyPowerSyncCrudEntryToSupabase(
  client: AbstrackSupabaseClient,
  entry: CrudEntry,
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
      .single();
    if (error) {
      throw error;
    }
    return;
  }

  if (entry.op === UpdateType.DELETE) {
    const { error } = await client
      .from(table as never)
      .delete()
      .eq('id', id)
      .select('id')
      .single();
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
  const dequeueThrough = resolvePowerSyncHandleCrudCheckpoint(database);
  for (const entry of batch.crud) {
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    await dequeueThrough(entry.clientId);
  }
}
