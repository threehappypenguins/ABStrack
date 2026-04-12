/**
 * Mobile symptom preset operations: all persistence goes through `@abstrack/supabase` preset helpers
 * (shared data layer). Screens must not call `client.from(...)` directly.
 */
import type {
  PresetSymptomInsert,
  PresetSymptomUpdate,
  SymptomPresetInsert,
  SymptomPresetUpdate,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  createPresetSymptom,
  createSymptomPreset,
  deletePresetSymptom,
  deleteSymptomPreset,
  getAuthUser,
  getSymptomPresetById,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetSymptoms,
  toPresetDataError,
  updatePresetSymptom,
  updateSymptomPreset,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Resolves the signed-in user id, or distinguishes “no session” from {@link getAuthUser} failures
 * (network, Supabase outage, etc.) so UIs can show an accurate message and offer retry.
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
 * Lists the signed-in user’s symptom presets.
 *
 * @returns {@link PresetDataResult} of preset rows or an error.
 */
export function fetchSymptomPresets() {
  return listSymptomPresets(getMobileSupabaseClient());
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
