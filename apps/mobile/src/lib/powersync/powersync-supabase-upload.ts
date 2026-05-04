import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type { CrudBatch, CrudEntry } from '@powersync/react-native';
import { UpdateType } from '@powersync/react-native';

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
 * PATCH uses PostgREST `select('id').single()` after `update` so zero-row updates (deleted row, RLS
 * hiding the row) return an error instead of succeeding silently before {@link CrudBatch#complete}.
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
      .eq('id', id);
    if (error) {
      throw error;
    }
  }
}

/**
 * Uploads an entire {@link CrudBatch} to Supabase and completes it.
 *
 * @param client - Authenticated Supabase client.
 * @param batch - Non-empty batch from {@link AbstractPowerSyncDatabase#getCrudBatch}.
 */
export async function uploadPowerSyncCrudBatchToSupabase(
  client: AbstrackSupabaseClient,
  batch: CrudBatch,
): Promise<void> {
  for (const entry of batch.crud) {
    await applyPowerSyncCrudEntryToSupabase(client, entry);
  }
  await batch.complete();
}
