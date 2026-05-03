import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

import { uploadPowerSyncCrudBatchToSupabase } from './powersync-supabase-upload';

export interface SupabaseSessionLike {
  access_token: string;
}

/**
 * Backend connector that authenticates to PowerSync with the current Supabase session JWT.
 * Configure the PowerSync Service to validate Supabase-issued tokens for your project.
 *
 * **Uploads:** Queued local writes on replicated tables are applied with the same Supabase client
 * (RLS) via {@link uploadPowerSyncCrudBatchToSupabase}.
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
      const session = await options.getSession();
      if (!session?.access_token) return null;
      return {
        endpoint: options.powerSyncUrl,
        token: session.access_token,
      };
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
        await uploadPowerSyncCrudBatchToSupabase(client, batch);
        if (!batch.haveMore) return;
      }
    },
  };
}
