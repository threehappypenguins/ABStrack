/**
 * Mobile health marker preset operations: persistence uses `@abstrack/supabase` preset helpers
 * (shared data layer). Screens must not call `client.from(...)` directly.
 */
import type {
  HealthMarkerPresetInsert,
  HealthMarkerPresetRow,
  HealthMarkerPresetUpdate,
  PresetHealthMarkerInsert,
  PresetHealthMarkerUpdate,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  createHealthMarkerPreset,
  createPresetHealthMarker,
  deleteHealthMarkerPreset,
  deletePresetHealthMarker,
  getHealthMarkerPresetById,
  listHealthMarkerPresets,
  listPresetHealthMarkersForPreset,
  reorderPresetHealthMarkers,
  toPresetDataError,
  updateHealthMarkerPreset,
  updatePresetHealthMarker,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import { resolveMobilePhiSubjectUserContext } from '../phi-subject/resolve-mobile-phi-subject-user-context';
import { listHealthMarkerPresetsForUserFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';
import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  resolvePowerSyncDatabaseForOfflineRead,
  type PowerSyncOfflineReadContext,
} from '../powersync/powersync-offline-read-bridge-snapshot';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
  isAuthSessionRecoveryFailure,
  readPersistedMobileAuthUserId,
} from '../supabase-wiring';

/**
 * Resolves the signed-in user id from the persisted session (offline-safe).
 * When {@link getMobileAuthSessionSafe} returns `auth_session_recovery_failed`, falls back to
 * {@link readPersistedMobileAuthUserId} (same as symptom presets) so offline replica reads survive
 * transient secure-store / recovery failures.
 *
 * @returns `{ ok: true, data: id }` when signed in; `{ ok: true, data: null }` when signed out with
 * no auth error; `{ ok: false, error }` when the session read failed.
 */
export async function getCurrentUserId(): Promise<
  PresetDataResult<string | null>
> {
  try {
    const {
      data: { session },
      error,
    } = await getMobileAuthSessionSafe();
    if (!error) {
      return { ok: true, data: session?.user?.id ?? null };
    }
    if (!isAuthSessionRecoveryFailure(error)) {
      return { ok: false, error: toPresetDataError(error) };
    }
    const persistedId = await readPersistedMobileAuthUserId();
    if (persistedId != null) {
      return { ok: true, data: persistedId };
    }
    return { ok: false, error: toPresetDataError(error) };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Resolves which `user_id` to filter on for offline replica preset lists.
 *
 * When `explicitScopeUserId` is a non-empty string, returns it. Otherwise, when `replicaDb` is set,
 * uses {@link resolveMobilePhiSubjectUserContext} so caretaker sessions query the linked patient’s
 * rows. Falls back to {@link getCurrentUserId} when no replica is available or PHI scope is unavailable.
 *
 * @param explicitScopeUserId - Optional PHI row owner from the caller (skips resolver when set).
 * @param replicaDb - Open PowerSync database when reading SQLite; enables PHI resolution when scope is omitted.
 */
async function resolveOfflinePresetListScopeUserId(
  explicitScopeUserId: string | null | undefined,
  replicaDb: PowerSyncDatabase | null,
): Promise<PresetDataResult<string | null>> {
  if (explicitScopeUserId != null) {
    const trimmed = explicitScopeUserId.trim();
    if (trimmed !== '') {
      return { ok: true, data: trimmed };
    }
  }
  if (replicaDb) {
    const phi = await resolveMobilePhiSubjectUserContext({
      powerSyncDatabase: replicaDb,
    });
    if (!phi.ok) {
      return phi;
    }
    const subject =
      phi.data?.phiSubjectUserId != null
        ? phi.data.phiSubjectUserId.trim()
        : '';
    if (subject !== '') {
      return { ok: true, data: subject };
    }
  }
  return getCurrentUserId();
}

/**
 * Lists the signed-in user’s health marker presets, falling back to the PowerSync replica when
 * Supabase is unreachable and {@link resolvePowerSyncDatabaseForOfflineRead} returns a database
 * handle. That resolver enforces {@link canUsePowerSyncReplicaForOfflineReads}; list screens should
 * pass `replicationReady` from `powerSyncOfflineReplicaReadsEnabled(usePowerSyncBridgeState())` so an
 * **init-only** replica without a completed first sync (or persisted landing for this user) does
 * **not** yield SQLite here — avoiding an empty list that would mask the “sync once while online”
 * path handled by {@link clarifyNetworkErrorWhenReplicaUnavailable}.
 *
 * When the replica is already trusted for offline reads and NetInfo reports **explicitly offline**
 * (`fetchMobileDeviceIsConnected() === false`), reads SQLite immediately instead of waiting for a
 * Supabase list timeout (same pattern as `fetchSymptomPresets` in `symptom-preset-service.ts`).
 * If that SQLite read throws, the returned error is the mapped local failure (not a masked Supabase
 * network result).
 *
 * @param options.powerSyncOfflineRead - From `usePowerSyncBridgeState()` when calling from UI.
 * @param options.scopeUserId - Optional PHI row owner for replica SQL. When omitted but a replica
 *   handle is used, {@link resolveMobilePhiSubjectUserContext} supplies the subject. Otherwise
 *   {@link getCurrentUserId} is used.
 */
export async function fetchHealthMarkerPresets(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
  scopeUserId?: string | null;
}): Promise<PresetDataResult<HealthMarkerPresetRow[]>> {
  const client = getMobileSupabaseClient();
  const db = resolvePowerSyncDatabaseForOfflineRead(
    options?.powerSyncOfflineRead ?? null,
  );

  if (db) {
    const connected = await fetchMobileDeviceIsConnected();
    if (connected === false) {
      const auth = await resolveOfflinePresetListScopeUserId(
        options?.scopeUserId,
        db,
      );
      if (!auth.ok) {
        return auth;
      }
      if (auth.data == null) {
        return listHealthMarkerPresets(client);
      }
      try {
        const data = await listHealthMarkerPresetsForUserFromPowerSyncDb(
          db,
          auth.data,
        );
        return { ok: true, data };
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
    }
  }

  const remote = await listHealthMarkerPresets(client);
  if (remote.ok) {
    return remote;
  }
  if (!isPresetDataNetworkError(remote.error)) {
    return remote;
  }
  // Same server-mirror gate as symptom presets: not init() alone (see bridge snapshot + landing storage).
  if (!db) {
    const alt = clarifyNetworkErrorWhenReplicaUnavailable(remote.error);
    return alt ? { ok: false, error: alt } : remote;
  }
  const auth = await resolveOfflinePresetListScopeUserId(
    options?.scopeUserId,
    db,
  );
  if (!auth.ok || auth.data == null) {
    return remote;
  }
  try {
    const data = await listHealthMarkerPresetsForUserFromPowerSyncDb(
      db,
      auth.data,
    );
    return { ok: true, data };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Fetches one preset header by id.
 */
export function fetchHealthMarkerPresetById(id: string) {
  return getHealthMarkerPresetById(getMobileSupabaseClient(), id);
}

/**
 * Creates a new empty preset header.
 */
export function saveNewHealthMarkerPreset(row: HealthMarkerPresetInsert) {
  return createHealthMarkerPreset(getMobileSupabaseClient(), row);
}

/**
 * Renames a preset header.
 */
export function saveHealthMarkerPresetName(
  id: string,
  patch: HealthMarkerPresetUpdate,
) {
  return updateHealthMarkerPreset(getMobileSupabaseClient(), id, patch);
}

/**
 * Deletes a preset and its lines.
 */
export function removeHealthMarkerPreset(id: string) {
  return deleteHealthMarkerPreset(getMobileSupabaseClient(), id);
}

/**
 * Lists ordered health marker lines for a preset.
 */
export function fetchPresetHealthMarkers(presetId: string) {
  return listPresetHealthMarkersForPreset(getMobileSupabaseClient(), presetId);
}

/**
 * Adds one marker line.
 */
export function saveNewPresetHealthMarker(row: PresetHealthMarkerInsert) {
  return createPresetHealthMarker(getMobileSupabaseClient(), row);
}

/**
 * Updates one marker line.
 */
export function savePresetHealthMarker(
  id: string,
  patch: PresetHealthMarkerUpdate,
) {
  return updatePresetHealthMarker(getMobileSupabaseClient(), id, patch);
}

/**
 * Deletes one marker line.
 */
export function removePresetHealthMarker(id: string) {
  return deletePresetHealthMarker(getMobileSupabaseClient(), id);
}

/**
 * Persists a new order for all lines in a preset.
 */
export function savePresetHealthMarkerOrder(
  presetId: string,
  orderedLineIds: string[],
): Promise<PresetDataResult<void>> {
  return reorderPresetHealthMarkers(
    getMobileSupabaseClient(),
    presetId,
    orderedLineIds,
  );
}
