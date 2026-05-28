/**
 * Mobile episode template operations: persistence only through `@abstrack/supabase` helpers.
 *
 * {@link getCurrentUserId} is re-exported from the shared preset offline auth helper (same
 * implementation as symptom / health-marker preset services). PowerSync SQLite reads use
 * {@link resolveOfflinePresetListScopeUserId} so `episode_templates.user_id` (PHI subject) matches
 * caretaker sessions; pass {@link EpisodeTemplateFetchOptions.scopeUserId} from UI when known.
 */
import type {
  EpisodeTemplateInsert,
  EpisodeTemplateUpdate,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  PresetDataError,
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
import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  resolvePowerSyncDatabaseForOfflineRead,
  type PowerSyncOfflineReadContext,
} from '../powersync/powersync-offline-read-bridge-snapshot';
import {
  getMobileAuthUserIdForPresetListOffline,
  resolveOfflinePresetListScopeUserId,
} from '../phi-subject/resolve-offline-preset-list-scope-user-id';
import { getMobileSupabaseClient } from '../supabase-wiring';

/** @see {@link getMobileAuthUserIdForPresetListOffline} */
export const getCurrentUserId = getMobileAuthUserIdForPresetListOffline;

type EpisodeTemplateFetchOptions = {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
  /**
   * Optional PHI row owner (`episode_templates.user_id`) for replica SQL. When omitted but a
   * replica handle is used, {@link resolveOfflinePresetListScopeUserId} supplies the subject
   * (caretaker → linked patient).
   */
  scopeUserId?: string | null;
};

/**
 * Lists episode templates with nested preset names, falling back to the PowerSync replica when
 * Supabase fails with a transport-style error, or substitutes SQLite when Supabase returns a
 * successful empty list — some paths yield `{ data: [], error: null }` without a transport error.
 * **SQLite** substitutes that empty list only when NetInfo reports **definitively offline**
 * (`fetchMobileDeviceIsConnected() === false`) and {@link resolvePowerSyncDatabaseForOfflineRead}
 * returns a handle, so unknown NetInfo (`null`, including after a failed fetch) never resurrects
 * stale rows after a real server-side empty response. The “open online once” replica-unavailable
 * message applies only when the device is **explicitly offline** and there is no DB handle; a
 * successful remote empty list stays authoritative when connectivity is unknown or online.
 *
 * When {@link resolvePowerSyncDatabaseForOfflineRead} returns a handle and NetInfo reports
 * **explicitly offline** (`fetchMobileDeviceIsConnected() === false`), reads SQLite first so a cold
 * offline open does not wait for `listEpisodeTemplates` to time out (same pattern as
 * `fetchSymptomPresets` / `fetchHealthMarkerPresets`). If a SQLite read throws while the device is
 * already known offline, the mapped local error is returned (not a masked Supabase network result).
 *
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @param options.scopeUserId - See {@link EpisodeTemplateFetchOptions.scopeUserId}.
 * @returns {@link PresetDataResult} of template rows or an error.
 */
export async function fetchEpisodeTemplates(
  options?: EpisodeTemplateFetchOptions,
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow[]>> {
  const client = getMobileSupabaseClient();
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );

  if (db) {
    const connected = await fetchMobileDeviceIsConnected();
    if (connected === false) {
      const scope = await resolveOfflinePresetListScopeUserId(
        options?.scopeUserId ?? null,
        db,
      );
      if (!scope.ok) {
        return scope;
      }
      if (scope.data == null) {
        return { ok: true, data: [] };
      }
      try {
        const data = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
          db,
          scope.data,
        );
        return { ok: true, data };
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
    }
  }

  const remote = await listEpisodeTemplates(client);

  if (remote.ok && remote.data.length > 0) {
    return remote;
  }

  const scope = await resolveOfflinePresetListScopeUserId(
    options?.scopeUserId ?? null,
    db,
  );
  if (!scope.ok || scope.data == null) {
    return remote;
  }
  const userId = scope.data;

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
    } catch (caught) {
      return { ok: false, error: toPresetDataError(caught) };
    }
  }

  // Supabase sometimes yields `{ data: [], error: null }` without a transport error when offline.
  // When a local replica is available, prefer it only when NetInfo has definitively confirmed we are offline.
  if (remote.ok && remote.data.length === 0) {
    const connected = await fetchMobileDeviceIsConnected();
    if (db && connected === false) {
      try {
        const localRows = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
          db,
          userId,
        );
        if (localRows.length > 0) {
          return { ok: true, data: localRows };
        }
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
    }
    if (!db && connected === false) {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(
        new PresetDataError('network_error', 'Network request failed'),
      );
      if (alt) {
        return { ok: false, error: alt };
      }
    }
  }

  return remote;
}

/**
 * Fetches one template by id with nested names, falling back to PowerSync like {@link fetchEpisodeTemplates}
 * for list-shaped responses. For **`ok` + `null`** (server not found), the replica is used only when
 * NetInfo reports **`isConnected === false`** so a successful remote “gone” is not overridden from
 * SQLite while online or when connectivity is unknown (`null`); that avoids reopening a stale row
 * for edit after server delete or RLS loss. When there is **no** offline-read DB handle yet (cold
 * start offline before first sync) but NetInfo is explicitly offline, the same
 * {@link clarifyNetworkErrorWhenReplicaUnavailable} path as the list applies so the editor does not
 * show a bare “template not found” for transport-shaped empties.
 *
 * When {@link resolvePowerSyncDatabaseForOfflineRead} returns a handle and NetInfo reports **explicitly
 * offline**, reads SQLite **before** `getEpisodeTemplateById` when a matching local row exists so
 * offline edit flows avoid a remote timeout (same idea as {@link fetchEpisodeTemplates} list fast path).
 * SQLite failures in those offline paths return `toPresetDataError` instead of masking with the
 * remote result.
 *
 * @param id - Template row id.
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @param options.scopeUserId - See {@link EpisodeTemplateFetchOptions.scopeUserId}.
 */
export async function fetchEpisodeTemplateById(
  id: string,
  options?: EpisodeTemplateFetchOptions,
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow | null>> {
  const client = getMobileSupabaseClient();
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );
  let userId: string | null = null;
  if (db) {
    const scope = await resolveOfflinePresetListScopeUserId(
      options?.scopeUserId ?? null,
      db,
    );
    if (scope.ok && scope.data != null) {
      userId = scope.data;
      const connected = await fetchMobileDeviceIsConnected();
      if (connected === false) {
        try {
          const localRow =
            await getEpisodeTemplateWithPresetsByIdFromPowerSyncDb(
              db,
              id,
              userId,
            );
          if (localRow != null) {
            return { ok: true, data: localRow };
          }
        } catch (caught) {
          return { ok: false, error: toPresetDataError(caught) };
        }
      }
    }
  }

  const remote = await getEpisodeTemplateById(client, id);

  if (remote.ok && remote.data != null) {
    return remote;
  }

  if (userId == null) {
    const scope = await resolveOfflinePresetListScopeUserId(
      options?.scopeUserId ?? null,
      db,
    );
    if (!scope.ok || scope.data == null) {
      return remote;
    }
    userId = scope.data;
  }

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
      if (data != null) {
        return { ok: true, data };
      }
      return remote;
    } catch (caught) {
      return { ok: false, error: toPresetDataError(caught) };
    }
  }

  // Stricter than list: `ok` + `null` means the server answered "not found"; only substitute SQLite
  // when explicitly offline — `null` NetInfo must not resurrect a row the server no longer returns.
  if (remote.ok && remote.data == null && db) {
    const connected = await fetchMobileDeviceIsConnected();
    if (connected === false) {
      try {
        const localRow = await getEpisodeTemplateWithPresetsByIdFromPowerSyncDb(
          db,
          id,
          userId,
        );
        if (localRow != null) {
          return { ok: true, data: localRow };
        }
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
    }
  }

  if (remote.ok && remote.data == null && !db) {
    const connected = await fetchMobileDeviceIsConnected();
    if (connected === false) {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(
        new PresetDataError('network_error', 'Network request failed'),
      );
      if (alt) {
        return { ok: false, error: alt };
      }
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
