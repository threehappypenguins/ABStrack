import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

import { uploadPowerSyncCrudBatchToSupabase } from './powersync-supabase-upload';
import { isPowerSyncUploadPermanentServerFailure } from './powersync-upload-permanent-failure';

/**
 * Maximum CRUD entries per {@link AbstractPowerSyncDatabase#getCrudBatch} call from this connector.
 * Using `1` avoids multi-op batches where a mid-batch permanent failure would either dequeue unsent
 * tail ops ({@link CrudBatch#complete} applies to the whole batch) or block the queue head if we
 * skip `complete()`.
 */
export const SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT = 1 as const;

export interface SupabaseSessionLike {
  access_token: string;
}

/**
 * Backend connector that authenticates to PowerSync with the current Supabase session JWT.
 * Configure the PowerSync Service to validate Supabase-issued tokens for your project.
 *
 * **Uploads:** Queued local writes on replicated tables are applied with the same Supabase client
 * (RLS) via {@link uploadPowerSyncCrudBatchToSupabase}. Batches are requested with
 * {@link SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT} so each batch has at most one CRUD entry:
 * a permanent rejection can safely call {@link CrudBatch#complete} without dropping unsent tail ops
 * or leaving the upload queue stuck on the same head batch. **Transient** failures (network, 5xx,
 * HTTP **401** / **429**, JWT/session) keep the batch pending for retry. **Permanent** rejections
 * (RLS, FK, constraints, other 4xx / PostgREST client errors) dequeue the offending op after
 * {@link isPowerSyncUploadPermanentServerFailure} (local row may diverge until the next successful
 * sync; see product docs).
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
        const batch = await database.getCrudBatch(
          SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT,
        );
        if (!batch) return;
        if (batch.crud.length === 0) {
          await batch.complete();
          if (!batch.haveMore) return;
          continue;
        }
        try {
          await uploadPowerSyncCrudBatchToSupabase(client, batch);
        } catch (e) {
          if (isPowerSyncUploadPermanentServerFailure(e)) {
            console.warn(
              '[PowerSync] Upload batch rejected by server (dequeuing; local row may diverge until next sync):',
              e instanceof Error ? e.message : e,
            );
            let completeSucceeded = false;
            try {
              await batch.complete();
              completeSucceeded = true;
            } catch (completeErr) {
              console.warn(
                '[PowerSync] batch.complete after permanent upload failure:',
                completeErr instanceof Error
                  ? completeErr.message
                  : completeErr,
              );
            }
            if (!completeSucceeded) {
              return;
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
