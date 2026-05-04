import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

import { uploadPowerSyncCrudBatchToSupabase } from './powersync-supabase-upload';
import { isPowerSyncUploadPermanentServerFailure } from './powersync-upload-permanent-failure';

export interface SupabaseSessionLike {
  access_token: string;
}

/**
 * Backend connector that authenticates to PowerSync with the current Supabase session JWT.
 * Configure the PowerSync Service to validate Supabase-issued tokens for your project.
 *
 * **Uploads:** Queued local writes on replicated tables are applied with the same Supabase client
 * (RLS) via {@link uploadPowerSyncCrudBatchToSupabase}. **Transient** failures (network, 5xx,
 * JWT/session) keep the batch pending for retry. **Permanent** rejections (RLS, FK, constraints,
 * other 4xx / PostgREST client errors) call `batch.complete()` only for **single-op** batches so a
 * bad row does not block forever (see {@link isPowerSyncUploadPermanentServerFailure}). For
 * **multi-op** batches, completing after a mid-batch failure would dequeue operations that were never
 * sent to Supabase, so we skip `complete()` and leave the batch pending to retry.
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
        const batch = await database.getCrudBatch();
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
            const multiOp = batch.crud.length > 1;
            console.warn(
              multiOp
                ? '[PowerSync] Permanent upload failure in a multi-op batch; not completing so queued tail ops are not dropped (batch will retry):'
                : '[PowerSync] Upload batch rejected by server (dequeuing; local row may diverge until next sync):',
              e instanceof Error ? e.message : e,
            );
            if (!multiOp) {
              try {
                await batch.complete();
              } catch (completeErr) {
                console.warn(
                  '[PowerSync] batch.complete after permanent upload failure:',
                  completeErr instanceof Error
                    ? completeErr.message
                    : completeErr,
                );
              }
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
