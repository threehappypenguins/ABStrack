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
  listEpisodeTemplates,
  toPresetDataError,
  updateEpisodeTemplate,
} from '@abstrack/supabase';
import {
  getEpisodeTemplateWithPresetsByIdFromPowerSyncDb,
  listEpisodeTemplatesWithPresetsFromPowerSyncDb,
} from '../powersync/powersync-episode-flow-reads';
import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  resolvePowerSyncDatabaseForOfflineRead,
  type PowerSyncOfflineReadContext,
} from '../powersync/powersync-offline-read-bridge-snapshot';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../supabase-wiring';

/**
 * Resolves the signed-in user id for template saves (same pattern as symptom preset service).
 * Uses {@link getMobileAuthSessionSafe} (local persisted session) rather than `getUser()` so airplane mode
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
    } = await getMobileAuthSessionSafe();
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
 * Supabase fails with a transport-style error or returns an empty list while the replica is
 * readable (some offline paths yield `{ data: [], error: null }` instead of a network error).
 *
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @returns {@link PresetDataResult} of template rows or an error.
 */
export async function fetchEpisodeTemplates(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
}): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow[]>> {
  const client = getMobileSupabaseClient();
  const remote = await listEpisodeTemplates(client);

  if (remote.ok && remote.data.length > 0) {
    return remote;
  }

  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );

  const auth = await getCurrentUserId();
  if (!auth.ok || auth.data == null) {
    return remote;
  }
  const userId = auth.data;

  if (!remote.ok && isPresetDataNetworkError(remote.error)) {
    if (!db) {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
      return alt ? { ok: false, error: alt } : remote;
    }
    try {
      const data = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
        db,
        userId,
      );
      return { ok: true, data };
    } catch {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
      return alt ? { ok: false, error: alt } : remote;
    }
  }

  // Supabase sometimes yields `{ data: [], error: null }` offline; prefer replica rows when present.
  if (remote.ok && remote.data.length === 0 && db) {
    try {
      const localRows = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
        db,
        userId,
      );
      if (localRows.length > 0) {
        return { ok: true, data: localRows };
      }
    } catch {
      /* keep remote */
    }
  }

  return remote;
}

/**
 * Fetches one template by id with nested names, falling back to PowerSync like {@link fetchEpisodeTemplates}.
 *
 * @param id - Template row id.
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 */
export async function fetchEpisodeTemplateById(
  id: string,
  options?: { powerSyncOfflineRead?: PowerSyncOfflineReadContext | null },
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow | null>> {
  const client = getMobileSupabaseClient();
  const remote = await getEpisodeTemplateById(client, id);

  if (remote.ok && remote.data != null) {
    return remote;
  }

  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );

  const auth = await getCurrentUserId();
  if (!auth.ok || auth.data == null) {
    return remote;
  }
  const userId = auth.data;

  if (!remote.ok && isPresetDataNetworkError(remote.error)) {
    if (!db) {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
      return alt ? { ok: false, error: alt } : remote;
    }
    try {
      const data = await getEpisodeTemplateWithPresetsByIdFromPowerSyncDb(
        db,
        id,
        userId,
      );
      return { ok: true, data };
    } catch {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
      return alt ? { ok: false, error: alt } : remote;
    }
  }

  if (remote.ok && remote.data == null && db) {
    try {
      const localRow = await getEpisodeTemplateWithPresetsByIdFromPowerSyncDb(
        db,
        id,
        userId,
      );
      if (localRow != null) {
        return { ok: true, data: localRow };
      }
    } catch {
      /* keep remote */
    }
  }

  return remote;
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
