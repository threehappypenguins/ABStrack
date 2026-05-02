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
  getSession,
  getSymptomPresetById,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetSymptoms,
  toPresetDataError,
  updatePresetSymptom,
  updateSymptomPreset,
} from '@abstrack/supabase';
import { listSymptomPresetsForUserFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';
import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  resolvePowerSyncDatabaseForOfflineRead,
  type PowerSyncOfflineReadContext,
} from '../powersync/powersync-offline-read-bridge-snapshot';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Resolves the signed-in user id from the persisted session (same pattern as episode templates).
 * Uses {@link getSession} rather than `getUser()` so airplane mode does not fail the auth lookup.
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
 * Lists the signed-in user’s symptom presets, falling back to the PowerSync replica when Supabase
 * is unreachable and replication has completed at least once.
 *
 * @param options.powerSyncOfflineRead - Prefer passing `usePowerSyncBridgeState()` fields from the
 *   screen so reads use the same DB instance as `PowerSyncContext` (PowerSync SDK lifecycle).
 * @returns {@link PresetDataResult} of preset rows or an error.
 */
export async function fetchSymptomPresets(options?: {
  powerSyncOfflineRead?: PowerSyncOfflineReadContext | null;
}): Promise<PresetDataResult<SymptomPresetRow[]>> {
  const client = getMobileSupabaseClient();
  const remote = await listSymptomPresets(client);
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
    const data = await listSymptomPresetsForUserFromPowerSyncDb(db, auth.data);
    return { ok: true, data };
  } catch {
    return remote;
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
