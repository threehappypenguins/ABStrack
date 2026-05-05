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
 * `fetchSymptomPresets` / `fetchHealthMarkerPresets`).
 *
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @returns {@link PresetDataResult} of template rows or an error.
 */
export async function fetchEpisodeTemplates(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
}): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow[]>> {
  const client = getMobileSupabaseClient();
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );

  if (db) {
    const connected = await fetchMobileDeviceIsConnected();
    if (connected === false) {
      const auth = await getCurrentUserId();
      if (!auth.ok) {
        return auth;
      }
      if (auth.data == null) {
        return listEpisodeTemplates(client);
      }
      try {
        const data = await listEpisodeTemplatesWithPresetsFromPowerSyncDb(
          db,
          auth.data,
        );
        return { ok: true, data };
      } catch {
        const remote = await listEpisodeTemplates(client);
        if (remote.ok) {
          return remote;
        }
        if (!isPresetDataNetworkError(remote.error)) {
          return remote;
        }
        const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
        return alt ? { ok: false, error: alt } : remote;
      }
    }
  }

  const remote = await listEpisodeTemplates(client);

  if (remote.ok && remote.data.length > 0) {
    return remote;
  }

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

  // Supabase sometimes yields `{ data: [], error: null }` without a transport error when offline.
  // Only override a successful empty response from SQLite when NetInfo definitively reports offline.
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
      } catch {
        /* keep remote */
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
 * for edit after server delete or RLS loss.
 *
 * When {@link resolvePowerSyncDatabaseForOfflineRead} returns a handle and NetInfo reports **explicitly
 * offline**, reads SQLite **before** `getEpisodeTemplateById` when a matching local row exists so
 * offline edit flows avoid a remote timeout (same idea as {@link fetchEpisodeTemplates} list fast path).
 *
 * @param id - Template row id.
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 */
export async function fetchEpisodeTemplateById(
  id: string,
  options?: { powerSyncOfflineRead?: PowerSyncOfflineReadContext | null },
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow | null>> {
  const client = getMobileSupabaseClient();
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );
  let userId: string | null = null;
  if (db) {
    const auth = await getCurrentUserId();
    if (auth.ok && auth.data != null) {
      userId = auth.data;
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
        } catch {
          /* fall through to remote */
        }
      }
    }
  }

  const remote = await getEpisodeTemplateById(client, id);

  if (remote.ok && remote.data != null) {
    return remote;
  }

  if (userId == null) {
    const auth = await getCurrentUserId();
    if (!auth.ok || auth.data == null) {
      return remote;
    }
    userId = auth.data;
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
      return { ok: true, data };
    } catch {
      const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
      return alt ? { ok: false, error: alt } : remote;
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
      } catch {
        /* keep remote */
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
