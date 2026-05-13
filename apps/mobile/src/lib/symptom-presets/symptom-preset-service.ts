/**
 * Mobile symptom preset operations: all persistence goes through `@abstrack/supabase` preset helpers
 * (shared data layer). Screens must not call `client.from(...)` directly.
 */
import type {
  PresetSymptomInsert,
  PresetSymptomUpdate,
  SymptomPresetInsert,
  SymptomPresetRow,
  SymptomPresetUpdate,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  createPresetSymptom,
  createSymptomPreset,
  deletePresetSymptom,
  deleteSymptomPreset,
  getSymptomPresetById,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetSymptoms,
  toPresetDataError,
  updatePresetSymptom,
  updateSymptomPreset,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import { resolveMobilePhiSubjectUserContext } from '../phi-subject/resolve-mobile-phi-subject-user-context';
import { listSymptomPresetsForUserFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';
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
 * Resolves the signed-in user id from the persisted session (same pattern as episode templates).
 * Uses {@link getMobileAuthSessionSafe} rather than `getUser()` so airplane mode does not fail the auth lookup.
 * When that helper returns `auth_session_recovery_failed`, falls back to {@link readPersistedMobileAuthUserId}
 * so transient secure-store / recovery hiccups do not block offline PowerSync preset lists.
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
 * When `explicitScopeUserId` is a non-empty string, returns it. Otherwise, when `replicaDb` is
 * set, uses {@link resolveMobilePhiSubjectUserContext} so caretaker sessions query the linked
 * patient’s rows instead of the caretaker auth uid. Falls back to {@link getCurrentUserId} when no
 * replica is available or PHI scope is unavailable.
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
 * Lists the signed-in user’s symptom presets, falling back to the PowerSync replica when Supabase
 * is unreachable and the bridge reports the replica is ready for server-mirror reads (first sync
 * this session or a persisted first-sync landing for this user on device).
 *
 * When the replica is already trusted for offline reads and NetInfo reports **explicitly offline**
 * (`fetchMobileDeviceIsConnected() === false`), reads SQLite immediately instead of waiting for a
 * Supabase list timeout (same idea as `HomeScreen` skipping the network resume fetch when offline).
 * If that SQLite read throws, the returned error is the mapped local failure (not a masked Supabase
 * network result).
 *
 * @param options.powerSyncOfflineRead - Prefer passing `usePowerSyncBridgeState()` fields from the
 *   screen so reads use the same DB instance as `PowerSyncContext` (PowerSync SDK lifecycle).
 * @param options.scopeUserId - Optional PHI row owner (`user_id`) for replica SQL. When omitted but
 *   a replica handle is used, {@link resolveMobilePhiSubjectUserContext} supplies the subject
 *   (caretaker → linked patient). Otherwise {@link getCurrentUserId} is used.
 * @returns {@link PresetDataResult} of preset rows or an error.
 */
export async function fetchSymptomPresets(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
  scopeUserId?: string | null;
}): Promise<PresetDataResult<SymptomPresetRow[]>> {
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
        return listSymptomPresets(client);
      }
      try {
        const data = await listSymptomPresetsForUserFromPowerSyncDb(
          db,
          auth.data,
        );
        return { ok: true, data };
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
    }
  }

  const remote = await listSymptomPresets(client);
  if (remote.ok) {
    return remote;
  }
  if (!isPresetDataNetworkError(remote.error)) {
    return remote;
  }
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
    const data = await listSymptomPresetsForUserFromPowerSyncDb(db, auth.data);
    return { ok: true, data };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Fetches one preset header by id.
 *
 * @param id - `symptom_presets.id`.
 * @returns Preset row, `null` when not found, or an error.
 */
export function fetchSymptomPresetById(id: string) {
  return getSymptomPresetById(getMobileSupabaseClient(), id);
}

/**
 * Creates a new empty preset header.
 *
 * @param row - Insert payload (`user_id` must match the signed-in user under RLS).
 * @returns Created row or an error.
 */
export function saveNewSymptomPreset(row: SymptomPresetInsert) {
  return createSymptomPreset(getMobileSupabaseClient(), row);
}

/**
 * Renames a preset header.
 *
 * @param id - `symptom_presets.id`.
 * @param patch - Fields to change.
 * @returns Updated row or an error.
 */
export function saveSymptomPresetName(id: string, patch: SymptomPresetUpdate) {
  return updateSymptomPreset(getMobileSupabaseClient(), id, patch);
}

/**
 * Deletes a preset and its lines.
 *
 * @param id - `symptom_presets.id`.
 * @returns Success or an error.
 */
export function removeSymptomPreset(id: string) {
  return deleteSymptomPreset(getMobileSupabaseClient(), id);
}

/**
 * Lists ordered symptom lines for a preset.
 *
 * @param presetId - Parent `symptom_presets.id`.
 * @returns Lines ordered by `sort_order` or an error.
 */
export function fetchPresetSymptoms(presetId: string) {
  return listPresetSymptomsForPreset(getMobileSupabaseClient(), presetId);
}

/**
 * Adds one symptom line.
 *
 * @param row - Insert payload (include `sort_order`).
 * @returns Created line or an error.
 */
export function saveNewPresetSymptom(row: PresetSymptomInsert) {
  return createPresetSymptom(getMobileSupabaseClient(), row);
}

/**
 * Updates one symptom line.
 *
 * @param id - `preset_symptoms.id`.
 * @param patch - Fields to change.
 * @returns Updated line or an error.
 */
export function savePresetSymptom(id: string, patch: PresetSymptomUpdate) {
  return updatePresetSymptom(getMobileSupabaseClient(), id, patch);
}

/**
 * Deletes one symptom line.
 *
 * @param id - `preset_symptoms.id`.
 * @returns Success or an error.
 */
export function removePresetSymptom(id: string) {
  return deletePresetSymptom(getMobileSupabaseClient(), id);
}

/**
 * Persists a new order for all lines in a preset.
 *
 * @param presetId - `symptom_presets.id`.
 * @param orderedLineIds - Every line id for this preset, in display order.
 * @returns Success or an error.
 */
export function savePresetSymptomOrder(
  presetId: string,
  orderedLineIds: string[],
): Promise<PresetDataResult<void>> {
  return reorderPresetSymptoms(
    getMobileSupabaseClient(),
    presetId,
    orderedLineIds,
  );
}
