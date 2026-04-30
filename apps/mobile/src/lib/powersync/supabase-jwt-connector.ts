import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';

export interface SupabaseSessionLike {
  access_token: string;
}

/**
 * Backend connector that authenticates to PowerSync with the current Supabase session JWT.
 * Configure the PowerSync Service to validate Supabase-issued tokens for your project.
 *
 * **Uploads:** ABStrack writes mutating PHI through Supabase REST (RLS) while online; local CRUD on
 * synced tables is not enabled yet. If local writes appear in the upload queue, this connector
 * throws so data is not silently discarded (follow-up: upload batch to Supabase).
 *
 * @param options.powerSyncUrl PowerSync Service WebSocket HTTP endpoint (e.g. from dashboard).
 * @param options.getSession Resolves the active Supabase session or null when signed out.
 */
export function createSupabaseJwtPowerSyncConnector(options: {
  powerSyncUrl: string;
  getSession: () => Promise<SupabaseSessionLike | null>;
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
      for (;;) {
        const batch = await database.getCrudBatch();
        if (!batch) return;
        if (batch.crud.length > 0) {
          throw new Error(
            'Local CRUD on synced ABStrack tables is not enabled; use Supabase when online.',
          );
        }
        await batch.complete();
        if (!batch.haveMore) return;
      }
    },
  };
}
