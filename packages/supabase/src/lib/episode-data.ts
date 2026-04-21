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
 * Lists the caller’s completed episodes (`ended_at IS NOT NULL`), newest first, then by `id`
 * descending for a stable order when `ended_at` ties. Uses the same RLS as other `episodes` reads.
 *
 * @param client - Supabase client (RLS applies).
 * @param userId - `auth.users.id` / `episodes.user_id`.
 * @param options - `limit` caps rows (default 25).
 * @returns Completed episode rows, or a {@link PresetDataError} on failure.
 */
export async function listCompletedEpisodesForUser(
  client: AbstrackSupabaseClient,
  userId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<EpisodeRow[]>> {
  const limit = options.limit ?? 25;
  try {
    const { data, error } = await client
      .from('episodes')
      .select('*')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: (data ?? []) as EpisodeRow[] };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Sets `ended_at` on an episode that is still active (`ended_at IS NULL`). Uses the same RLS as
 * other `episodes` updates.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id` to close.
 * @param endedAt - Timestamp for `ended_at` (defaults to now, ISO string).
 * @returns On success, `didEnd` is `true` if exactly one active row was updated. `didEnd` is
 * `false` when the update matched no rows: e.g. the episode was already ended, `episodeId` does
 * not exist, or RLS hid the row from the update. Callers must not treat `didEnd: false` as proof
 * the episode was closed.
 */
export async function endEpisodeIfStillActive(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  endedAt: string = new Date().toISOString(),
): Promise<PresetDataResult<{ didEnd: boolean }>> {
  try {
    const { data, error } = await client
      .from('episodes')
      .update({ ended_at: endedAt })
      .eq('id', episodeId)
      .is('ended_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: { didEnd: data != null } };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Permanently removes an episode only when it is still active (`ended_at IS NULL`). Uses the same
 * RLS as other `episodes` deletes. Related rows follow schema foreign-key behavior: some
 * episode-scoped tables cascade-delete, while others are unlinked via `SET NULL`.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id` to cancel.
 * @returns On success, `didCancel` is `true` when one active row was deleted. `didCancel` is
 * `false` when no active row matched: e.g. the episode was already ended, does not exist, or RLS
 * prevented visibility.
 */
export async function cancelActiveEpisodeById(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<{ didCancel: boolean }>> {
  try {
    const { data, error } = await client
      .from('episodes')
      .delete()
      .eq('id', episodeId)
      .is('ended_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    return { ok: true, data: { didCancel: data != null } };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}
