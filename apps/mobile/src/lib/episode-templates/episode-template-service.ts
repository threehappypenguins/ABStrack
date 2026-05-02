/**
 * Mobile episode template operations: persistence only through `@abstrack/supabase` helpers.
 */
import type {
  EpisodeTemplateInsert,
  EpisodeTemplateUpdate,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  createEpisodeTemplate,
  deleteEpisodeTemplate,
  getEpisodeTemplateById,
  getSession,
  listEpisodeTemplates,
  toPresetDataError,
  updateEpisodeTemplate,
} from '@abstrack/supabase';
import { listEpisodeTemplatesWithPresetsFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';
import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  resolvePowerSyncDatabaseForOfflineRead,
  type PowerSyncOfflineReadContext,
} from '../powersync/powersync-offline-read-bridge-snapshot';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Resolves the signed-in user id for template saves (same pattern as symptom preset service).
 * Uses {@link getSession} (local persisted session) rather than `getUser()` so airplane mode
 * does not fail: `auth.getUser()` validates with the server and throws `Network request failed`.
 *
 * @returns User id, null when signed out, or an error when the session read fails.
 */
export async function getCurrentUserId(): Promise<
  PresetDataResult<string | null>
> {
  try {
    const {
      data: { session },
      error,
    } = await getSession(getMobileSupabaseClient());
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: session?.user?.id ?? null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Lists episode templates with nested preset names, falling back to the PowerSync replica when
 * Supabase is unreachable (e.g. airplane mode) and replication has completed at least once.
 *
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @returns {@link PresetDataResult} of template rows or an error.
 */
export async function fetchEpisodeTemplates(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
}): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow[]>> {
  const client = getMobileSupabaseClient();
  const remote = await listEpisodeTemplates(client);
  if (remote.ok) {
    return remote;
  }
  if (!isPresetDataNetworkError(remote.error)) {
    return remote;
  }
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );
  if (!db) {
    const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
    return alt ? { ok: false, error: alt } : remote;
  }
  const auth = await getCurrentUserId();
  if (!auth.ok || auth.data == null) {
    return remote;
  }
  try {
    const data = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
      db,
      auth.data,
    );
    return { ok: true, data };
  } catch {
    return remote;
  }
}

/** Fetches one template by id with nested names. */
export function fetchEpisodeTemplateById(id: string) {
  return getEpisodeTemplateById(getMobileSupabaseClient(), id);
}

/** Creates a template row. */
export function saveNewEpisodeTemplate(row: EpisodeTemplateInsert) {
  return createEpisodeTemplate(getMobileSupabaseClient(), row);
}

/** Updates a template. */
export function saveEpisodeTemplate(id: string, patch: EpisodeTemplateUpdate) {
  return updateEpisodeTemplate(getMobileSupabaseClient(), id, patch);
}

/** Deletes a template. */
export function removeEpisodeTemplate(id: string) {
  return deleteEpisodeTemplate(getMobileSupabaseClient(), id);
}
