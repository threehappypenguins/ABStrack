/**
 * Mobile episode template operations: persistence only through `@abstrack/supabase` helpers.
 */
import type {
  EpisodeTemplateInsert,
  EpisodeTemplateUpdate,
} from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  createEpisodeTemplate,
  deleteEpisodeTemplate,
  getEpisodeTemplateById,
  getAuthUser,
  listEpisodeTemplates,
  toPresetDataError,
  updateEpisodeTemplate,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Resolves the signed-in user id for template saves (same pattern as symptom preset service).
 *
 * @returns User id, null when signed out, or an error when the auth lookup fails.
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

/** Lists episode templates with nested preset names. */
export function fetchEpisodeTemplates() {
  return listEpisodeTemplates(getMobileSupabaseClient());
}

/** Fetches one template by id with nested names. */
export function fetchEpisodeTemplateById(id: string) {
  return getEpisodeTemplateById(getMobileSupabaseClient(), id);
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
