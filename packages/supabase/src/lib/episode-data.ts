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

/**
 * Returns the caller’s newest active episode (`ended_at IS NULL`), if any. Uses the same RLS as
 * other `episodes` reads; when multiple active rows exist (unexpected), the most recently started
 * wins.
 *
 * @param client - Supabase client (RLS applies).
 * @param userId - `auth.users.id` / `episodes.user_id`.
 * @returns The row, or `null` when there is no active episode.
 */
export async function getActiveEpisodeForUser(
  client: AbstrackSupabaseClient,
  userId: Uuid,
): Promise<PresetDataResult<EpisodeRow | null>> {
  try {
    const { data, error } = await client
      .from('episodes')
      .select('*')
      .eq('user_id', userId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: data as EpisodeRow | null };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Sets `ended_at` on an episode that is still active (`ended_at IS NULL`). If the row is already
 * ended, the update is a no-op and the call still succeeds — callers can proceed to start a new
 * episode. Uses the same RLS as other `episodes` updates.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id` to close.
 * @param endedAt - Timestamp for `ended_at` (defaults to now, ISO string).
 */
export async function endEpisodeIfStillActive(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  endedAt: string = new Date().toISOString(),
): Promise<PresetDataResult<void>> {
  try {
    const { error } = await client
      .from('episodes')
      .update({ ended_at: endedAt })
      .eq('id', episodeId)
      .is('ended_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    // When the row was already ended (or not visible under RLS), the update matches no rows — still
    // OK for “start a new episode” flows that assume no active row remains.
    return { ok: true, data: undefined };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}
