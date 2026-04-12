/**
 * Mobile health marker preset operations: persistence uses `@abstrack/supabase` preset helpers
 * (shared data layer). Screens must not call `client.from(...)` directly.
 */
import type {
  HealthMarkerPresetInsert,
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
  getAuthUser,
  getHealthMarkerPresetById,
  listHealthMarkerPresets,
  listPresetHealthMarkersForPreset,
  reorderPresetHealthMarkers,
  toPresetDataError,
  updateHealthMarkerPreset,
  updatePresetHealthMarker,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Resolves the signed-in user id, or distinguishes “no session” from {@link getAuthUser} failures.
 *
 * @returns `{ ok: true, data: id }` when signed in; `{ ok: true, data: null }` when signed out with
 * no auth error; `{ ok: false, error }` when the auth lookup failed.
 */
export async function getCurrentUserId(): Promise<
  PresetDataResult<string | null>
> {
  try {
    const {
      data: { user },
      error,
    } = await getAuthUser(getMobileSupabaseClient());
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: user?.id ?? null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Lists the signed-in user’s health marker presets.
 */
export function fetchHealthMarkerPresets() {
  return listHealthMarkerPresets(getMobileSupabaseClient());
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
