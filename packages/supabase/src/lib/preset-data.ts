import type {
  HealthMarkerPresetInsert,
  HealthMarkerPresetRow,
  HealthMarkerPresetUpdate,
  PresetHealthMarkerInsert,
  PresetHealthMarkerRow,
  PresetHealthMarkerUpdate,
  PresetSymptomInsert,
  PresetSymptomRow,
  PresetSymptomUpdate,
  SymptomPresetInsert,
  SymptomPresetRow,
  SymptomPresetUpdate,
} from '@abstrack/types';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Success or failure from preset data helpers. On failure, `error.message` is suitable for UI.
 */
export type PresetDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PresetDataError };

/** @internal Shared by preset and episode-template data modules. */
export async function wrap<T>(
  run: () => Promise<{ data: T | null; error: unknown }>,
): Promise<PresetDataResult<NonNullable<T>>> {
  try {
    const { data, error } = await run();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    if (data === null || data === undefined) {
      return {
        ok: false,
        error: new PresetDataError(
          'unknown',
          'Something went wrong. Please try again.',
        ),
      };
    }
    return { ok: true, data: data as NonNullable<T> };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

async function wrapVoid(
  run: () => Promise<{ error: unknown }>,
): Promise<PresetDataResult<void>> {
  try {
    const { error } = await run();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: undefined };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * DELETE with a returning row so 0-row deletes surface as PostgREST errors (e.g. PGRST116) instead of silent success.
 *
 * @internal Shared by preset and episode-template data modules.
 */
export async function wrapDeleteExpectOne(
  run: () => Promise<{ data: unknown; error: unknown }>,
): Promise<PresetDataResult<void>> {
  try {
    const { data, error } = await run();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    if (data === null || data === undefined) {
      return {
        ok: false,
        error: new PresetDataError(
          'not_found',
          'We could not find that item. It may have been removed.',
        ),
      };
    }
    return { ok: true, data: undefined };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Validates that `orderedIds` is a permutation of `existingIds` (same length, no duplicates, no extras).
 *
 * @param existingIds - Line ids currently stored for the preset.
 * @param orderedIds - Desired order; must list each existing id exactly once.
 * @returns A {@link PresetDataError} when invalid; otherwise `null`.
 */
export function validateReorderLineIds(
  existingIds: readonly string[],
  orderedIds: readonly string[],
): PresetDataError | null {
  const existing = new Set(existingIds);
  if (orderedIds.length !== existing.size) {
    return new PresetDataError(
      'validation_error',
      'Include every line exactly once in the order you want.',
    );
  }
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!existing.has(id)) {
      return new PresetDataError(
        'validation_error',
        'One of those lines is not part of this preset anymore. Refresh and try again.',
      );
    }
    if (seen.has(id)) {
      return new PresetDataError(
        'validation_error',
        'Each line can only appear once in the order.',
      );
    }
    seen.add(id);
  }
  return null;
}

// --- Symptom presets (header rows) ---

/**
 * Lists the signed-in user’s symptom presets with stable ordering (created_at, then id).
 *
 * @param client - Browser, native, or server Supabase client (RLS applies).
 */
export async function listSymptomPresets(
  client: AbstrackSupabaseClient,
): Promise<PresetDataResult<SymptomPresetRow[]>> {
  return wrap(async () => {
    const result = await client
      .from('symptom_presets')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    return {
      data: (result.data ?? []) as SymptomPresetRow[],
      error: result.error,
    };
  });
}

/**
 * Fetches one symptom preset by id when RLS allows.
 *
 * @param client - Supabase client.
 * @param id - `symptom_presets.id`.
 */
export async function getSymptomPresetById(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<SymptomPresetRow | null>> {
  try {
    const { data, error } = await client
      .from('symptom_presets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: data as SymptomPresetRow | null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Creates a symptom preset for the given user (must match the signed-in user under RLS).
 *
 * @param client - Supabase client.
 * @param row - Insert payload.
 */
export async function createSymptomPreset(
  client: AbstrackSupabaseClient,
  row: SymptomPresetInsert,
): Promise<PresetDataResult<SymptomPresetRow>> {
  return wrap(async () => {
    const r = await client
      .from('symptom_presets')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as SymptomPresetRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates a symptom preset header (e.g. rename).
 *
 * @param client - Supabase client.
 * @param id - `symptom_presets.id`.
 * @param patch - Fields to change.
 */
export async function updateSymptomPreset(
  client: AbstrackSupabaseClient,
  id: string,
  patch: SymptomPresetUpdate,
): Promise<PresetDataResult<SymptomPresetRow>> {
  return wrap(async () => {
    const r = await client
      .from('symptom_presets')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    return {
      data: r.data as SymptomPresetRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes a symptom preset (cascade removes its lines).
 * If no row matched (or RLS hides it), returns `{ ok: false, error }` with `not_found` or `permission_denied`, not a silent success.
 *
 * @param client - Supabase client.
 * @param id - `symptom_presets.id`.
 */
export async function deleteSymptomPreset(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('symptom_presets')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}

// --- Preset symptoms (lines) ---

/**
 * Lists symptoms for a preset in display order (sort_order, then id).
 *
 * @param client - Supabase client.
 * @param presetId - Parent `symptom_presets.id`.
 */
export async function listPresetSymptomsForPreset(
  client: AbstrackSupabaseClient,
  presetId: string,
): Promise<PresetDataResult<PresetSymptomRow[]>> {
  return wrap(async () => {
    const result = await client
      .from('preset_symptoms')
      .select('*')
      .eq('preset_id', presetId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    return {
      data: (result.data ?? []) as PresetSymptomRow[],
      error: result.error,
    };
  });
}

/**
 * Creates one line in a symptom preset.
 *
 * @param client - Supabase client.
 * @param row - Insert payload (include `sort_order`).
 */
export async function createPresetSymptom(
  client: AbstrackSupabaseClient,
  row: PresetSymptomInsert,
): Promise<PresetDataResult<PresetSymptomRow>> {
  return wrap(async () => {
    const r = await client
      .from('preset_symptoms')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as PresetSymptomRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates one preset symptom line.
 *
 * @param client - Supabase client.
 * @param id - `preset_symptoms.id`.
 * @param patch - Fields to change.
 */
export async function updatePresetSymptom(
  client: AbstrackSupabaseClient,
  id: string,
  patch: PresetSymptomUpdate,
): Promise<PresetDataResult<PresetSymptomRow>> {
  return wrap(async () => {
    const r = await client
      .from('preset_symptoms')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    return {
      data: r.data as PresetSymptomRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes one preset symptom line.
 * If no row matched (or RLS hides it), returns `{ ok: false, error }` — see {@link deleteSymptomPreset}.
 *
 * @param client - Supabase client.
 * @param id - `preset_symptoms.id`.
 */
export async function deletePresetSymptom(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('preset_symptoms')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}

/**
 * Persists a new display order for all lines in a symptom preset in one database transaction.
 *
 * @param client - Supabase client.
 * @param presetId - `symptom_presets.id`.
 * @param orderedLineIds - Every `preset_symptoms.id` for this preset, in order.
 */
export async function reorderPresetSymptoms(
  client: AbstrackSupabaseClient,
  presetId: string,
  orderedLineIds: string[],
): Promise<PresetDataResult<void>> {
  const lines = await listPresetSymptomsForPreset(client, presetId);
  if (!lines.ok) {
    return { ok: false, error: lines.error };
  }
  const existingIds = lines.data.map((r) => r.id);
  const invalid = validateReorderLineIds(existingIds, orderedLineIds);
  if (invalid) {
    return { ok: false, error: invalid };
  }
  return wrapVoid(async () => {
    const r = await client.rpc('reorder_preset_symptoms', {
      p_preset_id: presetId,
      p_ordered_ids: orderedLineIds,
    });
    return { error: r.error };
  });
}

// --- Health marker presets (header rows) ---

/**
 * Lists health marker presets with stable ordering.
 *
 * @param client - Supabase client.
 * @param options - When {@link options.scopeUserId} is set, restricts rows to that
 *   `health_marker_presets.user_id` (PHI subject) so caretaker UIs do not rely on RLS alone for
 *   preset ownership when listing.
 */
export async function listHealthMarkerPresets(
  client: AbstrackSupabaseClient,
  options?: { scopeUserId?: string },
): Promise<PresetDataResult<HealthMarkerPresetRow[]>> {
  return wrap(async () => {
    const scope = options?.scopeUserId?.trim();
    let query = client.from('health_marker_presets').select('*');
    if (scope) {
      query = query.eq('user_id', scope);
    }
    const result = await query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    return {
      data: (result.data ?? []) as HealthMarkerPresetRow[],
      error: result.error,
    };
  });
}

/**
 * Fetches one health marker preset by id when RLS allows.
 *
 * @param client - Supabase client.
 * @param id - `health_marker_presets.id`.
 * @param options - When {@link options.scopeUserId} is set, requires that owner id so a preset
 *   from another user id cannot be read through this helper alone.
 */
export async function getHealthMarkerPresetById(
  client: AbstrackSupabaseClient,
  id: string,
  options?: { scopeUserId?: string },
): Promise<PresetDataResult<HealthMarkerPresetRow | null>> {
  try {
    const scope = options?.scopeUserId?.trim();
    let query = client.from('health_marker_presets').select('*').eq('id', id);
    if (scope) {
      query = query.eq('user_id', scope);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: data as HealthMarkerPresetRow | null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Creates a health marker preset.
 *
 * @param client - Supabase client.
 * @param row - Insert payload.
 */
export async function createHealthMarkerPreset(
  client: AbstrackSupabaseClient,
  row: HealthMarkerPresetInsert,
): Promise<PresetDataResult<HealthMarkerPresetRow>> {
  return wrap(async () => {
    const r = await client
      .from('health_marker_presets')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as HealthMarkerPresetRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates a health marker preset header.
 *
 * @param client - Supabase client.
 * @param id - `health_marker_presets.id`.
 * @param patch - Fields to change.
 */
export async function updateHealthMarkerPreset(
  client: AbstrackSupabaseClient,
  id: string,
  patch: HealthMarkerPresetUpdate,
): Promise<PresetDataResult<HealthMarkerPresetRow>> {
  return wrap(async () => {
    const r = await client
      .from('health_marker_presets')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    return {
      data: r.data as HealthMarkerPresetRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes a health marker preset (cascade removes its lines).
 * If no row matched (or RLS hides it), returns `{ ok: false, error }` — see {@link deleteSymptomPreset}.
 *
 * @param client - Supabase client.
 * @param id - `health_marker_presets.id`.
 */
export async function deleteHealthMarkerPreset(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('health_marker_presets')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}

// --- Preset health markers (lines) ---

/**
 * Lists health marker lines for a preset in display order.
 *
 * @param client - Supabase client.
 * @param presetId - Parent `health_marker_presets.id`.
 * @param options - When {@link options.scopeUserId} is set, ensures the preset header belongs to
 *   that user before listing lines so callers cannot combine another user’s lines with a mismatched
 *   `user_id` on insert.
 */
export async function listPresetHealthMarkersForPreset(
  client: AbstrackSupabaseClient,
  presetId: string,
  options?: { scopeUserId?: string },
): Promise<PresetDataResult<PresetHealthMarkerRow[]>> {
  const scope = options?.scopeUserId?.trim();
  if (scope) {
    const preset = await getHealthMarkerPresetById(client, presetId, {
      scopeUserId: scope,
    });
    if (!preset.ok) {
      return { ok: false, error: preset.error };
    }
    if (preset.data == null) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'That health marker preset is not available for the current patient scope.',
        ),
      };
    }
  }
  return wrap(async () => {
    const result = await client
      .from('preset_health_markers')
      .select('*')
      .eq('preset_id', presetId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    return {
      data: (result.data ?? []) as PresetHealthMarkerRow[],
      error: result.error,
    };
  });
}

/**
 * Creates one line in a health marker preset.
 *
 * @param client - Supabase client.
 * @param row - Insert payload (include `sort_order`).
 */
export async function createPresetHealthMarker(
  client: AbstrackSupabaseClient,
  row: PresetHealthMarkerInsert,
): Promise<PresetDataResult<PresetHealthMarkerRow>> {
  return wrap(async () => {
    const r = await client
      .from('preset_health_markers')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as PresetHealthMarkerRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates one preset health marker line.
 *
 * @param client - Supabase client.
 * @param id - `preset_health_markers.id`.
 * @param patch - Fields to change.
 */
export async function updatePresetHealthMarker(
  client: AbstrackSupabaseClient,
  id: string,
  patch: PresetHealthMarkerUpdate,
): Promise<PresetDataResult<PresetHealthMarkerRow>> {
  return wrap(async () => {
    const r = await client
      .from('preset_health_markers')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    return {
      data: r.data as PresetHealthMarkerRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes one preset health marker line.
 * If no row matched (or RLS hides it), returns `{ ok: false, error }` — see {@link deleteSymptomPreset}.
 *
 * @param client - Supabase client.
 * @param id - `preset_health_markers.id`.
 */
export async function deletePresetHealthMarker(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('preset_health_markers')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}

/**
 * Persists a new display order for all lines in a health marker preset in one database transaction.
 *
 * @param client - Supabase client.
 * @param presetId - `health_marker_presets.id`.
 * @param orderedLineIds - Every `preset_health_markers.id` for this preset, in order.
 */
export async function reorderPresetHealthMarkers(
  client: AbstrackSupabaseClient,
  presetId: string,
  orderedLineIds: string[],
): Promise<PresetDataResult<void>> {
  const lines = await listPresetHealthMarkersForPreset(client, presetId);
  if (!lines.ok) {
    return { ok: false, error: lines.error };
  }
  const existingIds = lines.data.map((r) => r.id);
  const invalid = validateReorderLineIds(existingIds, orderedLineIds);
  if (invalid) {
    return { ok: false, error: invalid };
  }
  return wrapVoid(async () => {
    const r = await client.rpc('reorder_preset_health_markers', {
      p_preset_id: presetId,
      p_ordered_ids: orderedLineIds,
    });
    return { error: r.error };
  });
}
