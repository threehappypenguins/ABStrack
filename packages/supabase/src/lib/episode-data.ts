import type { EpisodeInsert, EpisodeRow, Uuid } from '@abstrack/types';
import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Inserts a new episode row (patient or caretaker per RLS).
 *
 * @param client - Supabase client (RLS applies).
 * @param row - Insert payload; `user_id` must satisfy `episodes_insert` policies.
 */
export async function createEpisode(
  client: AbstrackSupabaseClient,
  row: EpisodeInsert,
): Promise<PresetDataResult<EpisodeRow>> {
  return wrap(async () => {
    const r = await client.from('episodes').insert(row).select('*').single();
    return {
      data: r.data as EpisodeRow | null,
      error: r.error,
    };
  });
}

/**
 * Fetches one episode by id when RLS allows (typically the owner’s row).
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @returns The row, or `null` if not found / not visible.
 */
export async function getEpisodeById(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<EpisodeRow | null>> {
  try {
    const { data, error } = await client
      .from('episodes')
      .select('*')
      .eq('id', episodeId)
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: data as EpisodeRow | null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}
