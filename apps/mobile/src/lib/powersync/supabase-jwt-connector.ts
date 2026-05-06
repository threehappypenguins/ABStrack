import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

import { uploadPowerSyncCrudBatchToSupabase } from './powersync-supabase-upload';
import { isPowerSyncUploadPermanentServerFailure } from './powersync-upload-permanent-failure';

/**
 * Default CRUD entries per {@link AbstractPowerSyncDatabase#getCrudBatch} call from this connector.
 * Larger batches reduce reconnect drain time on high-latency links by avoiding one HTTP round-trip
 * per local mutation.
 */
export const SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT = 25 as const;

/**
 * Fallback batch size used after a permanent server rejection has been observed.
 *
 * Single-entry dequeue ensures {@link CrudBatch#complete} can drop only the offending head op
 * instead of acknowledging unsent tail entries in a larger batch.
 */
const SUPABASE_JWT_POWERSYNC_UPLOAD_SINGLE_OP_BATCH_LIMIT = 1 as const;

export interface SupabaseSessionLike {
  access_token: string;
}

/**
 * Backend connector that authenticates to PowerSync with the current Supabase session JWT.
 * Configure the PowerSync Service to validate Supabase-issued tokens for your project.
 *
 * **Uploads:** Queued local writes on replicated tables are applied with the same Supabase client
 * (RLS) via {@link uploadPowerSyncCrudBatchToSupabase} (each successful REST write checkpoints the
 * CRUD queue before the next entry). Starts with
 * {@link SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT} to drain reconnect bursts quickly, then
 * temporarily falls back to single-op batches after a permanent rejection so dequeue uses
 * {@link CrudBatch#complete} on one head op at a time (same {@link PowerSyncBackendConnector#uploadData}
 * pass immediately refetches at limit 1; it does not complete the oversized batch first). After one
 * successful single-op upload it
 * restores the default batch size for throughput. **Transient** failures (network, 5xx,
 * HTTP **401** / **429**, JWT/session) keep the batch pending for retry. **Permanent** rejections
 * (RLS, FK, constraints, other 4xx / PostgREST client errors) either trigger that single-op
 * fallback or dequeue directly when already single-op (local row may diverge until the next
 * successful sync; see product docs). If {@link CrudBatch#complete} throws after dequeuing the
 * head op, that error is rethrown so `uploadData` rejects and PowerSync can surface `uploadError`
 * instead of treating the upload pass as successful while the queue is stuck.
 *
 * @param options.powerSyncUrl PowerSync Service WebSocket HTTP endpoint (e.g. from dashboard).
 * @param options.getSession Resolves the active Supabase session or null when signed out.
 * @param options.getSupabaseClient Supabase JS client used to POST CRUD batches (user JWT).
 */
export function createSupabaseJwtPowerSyncConnector(options: {
  powerSyncUrl: string;
  getSession: () => Promise<SupabaseSessionLike | null>;
  getSupabaseClient: () => AbstrackSupabaseClient;
}): PowerSyncBackendConnector {
  let uploadBatchLimit: number = SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT;

  return {
    fetchCredentials: async (): Promise<PowerSyncCredentials | null> => {
      try {
        const session = await options.getSession();
        if (!session?.access_token) return null;
        return {
          endpoint: options.powerSyncUrl,
          token: session.access_token,
        };
      } catch {
        return null;
      }
    },

    uploadData: async (database: AbstractPowerSyncDatabase): Promise<void> => {
      const client = options.getSupabaseClient();
      for (;;) {
        const batch = await database.getCrudBatch(uploadBatchLimit);
        if (!batch) return;
        if (batch.crud.length === 0) {
          await batch.complete();
          if (!batch.haveMore) return;
          continue;
        }
        try {
          await uploadPowerSyncCrudBatchToSupabase(client, batch, database);
          if (
            uploadBatchLimit ===
            SUPABASE_JWT_POWERSYNC_UPLOAD_SINGLE_OP_BATCH_LIMIT
          ) {
            uploadBatchLimit = SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT;
          }
        } catch (e) {
          if (isPowerSyncUploadPermanentServerFailure(e)) {
            console.warn(
              '[PowerSync] Upload batch rejected by server (dequeuing; local row may diverge until next sync):',
              e instanceof Error ? e.message : e,
            );
            if (
              uploadBatchLimit !==
                SUPABASE_JWT_POWERSYNC_UPLOAD_SINGLE_OP_BATCH_LIMIT &&
              batch.crud.length > 1
            ) {
              uploadBatchLimit =
                SUPABASE_JWT_POWERSYNC_UPLOAD_SINGLE_OP_BATCH_LIMIT;
              console.warn(
                '[PowerSync] Falling back to single-op upload batches after permanent rejection.',
              );
              // Do not complete this multi-entry batch: `complete` would dequeue every op in the
              // batch (see PowerSync `getCrudBatch`). Fetch again at limit 1 so only the head op is
              // acknowledged on the next permanent/success path, and keep draining in this pass.
              continue;
            }
            try {
              await batch.complete();
            } catch (completeErr) {
              console.warn(
                '[PowerSync] batch.complete after permanent upload failure:',
                completeErr instanceof Error
                  ? completeErr.message
                  : completeErr,
              );
              throw completeErr instanceof Error
                ? completeErr
                : new Error(String(completeErr), { cause: completeErr });
            }
            if (!batch.haveMore) {
              return;
            }
            continue;
          }
          console.warn(
            '[PowerSync] Upload batch failed (will retry when online):',
            e instanceof Error ? e.message : e,
          );
          return;
        }
        if (!batch.haveMore) return;
      }
    },
  };
}
