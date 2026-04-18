import type {
  EpisodeTemplateInsert,
  EpisodeTemplateRow,
  EpisodeTemplateUpdate,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap, wrapDeleteExpectOne } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Lists the signed-in user’s episode templates with nested symptom and health marker preset names.
 *
 * @param client - Browser, native, or server Supabase client (RLS applies).
 */
export async function listEpisodeTemplates(
  client: AbstrackSupabaseClient,
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow[]>> {
  return wrap(async () => {
    const result = await client
      .from('episode_templates')
      .select(
        `
        *,
        symptom_preset:symptom_presets!episode_templates_symptom_preset_id_fk ( id, name ),
        health_marker_preset:health_marker_presets!episode_templates_health_marker_preset_id_fk ( id, name )
      `,
      )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    const rows = result.data as EpisodeTemplateWithPresetsRow[] | null;
    return {
      data: rows ?? [],
      error: result.error,
    };
  });
}

/**
 * Fetches one episode template by id with nested preset names when RLS allows.
 *
 * @param client - Supabase client.
 * @param id - `episode_templates.id`.
 */
export async function getEpisodeTemplateById(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<EpisodeTemplateWithPresetsRow | null>> {
  try {
    const { data, error } = await client
      .from('episode_templates')
      .select(
        `
        *,
        symptom_preset:symptom_presets!episode_templates_symptom_preset_id_fk ( id, name ),
        health_marker_preset:health_marker_presets!episode_templates_health_marker_preset_id_fk ( id, name )
      `,
      )
      .eq('id', id)
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return {
      ok: true,
      data: data as EpisodeTemplateWithPresetsRow | null,
    };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Creates an episode template (one symptom preset + one health marker preset under a display name).
 *
 * @param client - Supabase client.
 * @param row - Insert payload (`user_id` must match the signed-in user under RLS).
 */
export async function createEpisodeTemplate(
  client: AbstrackSupabaseClient,
  row: EpisodeTemplateInsert,
): Promise<PresetDataResult<EpisodeTemplateRow>> {
  return wrap(async () => {
    const r = await client
      .from('episode_templates')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as EpisodeTemplateRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates an episode template (name and/or linked presets).
 *
 * @param client - Supabase client.
 * @param id - `episode_templates.id`.
 * @param patch - Fields to change.
 */
export async function updateEpisodeTemplate(
  client: AbstrackSupabaseClient,
  id: string,
  patch: EpisodeTemplateUpdate,
): Promise<PresetDataResult<EpisodeTemplateRow>> {
  return wrap(async () => {
    const r = await client
      .from('episode_templates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    return {
      data: r.data as EpisodeTemplateRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes an episode template. If no row matched (or RLS hides it), returns an error — not silent success.
 *
 * @param client - Supabase client.
 * @param id - `episode_templates.id`.
 */
export async function deleteEpisodeTemplate(
  client: AbstrackSupabaseClient,
  id: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('episode_templates')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}
