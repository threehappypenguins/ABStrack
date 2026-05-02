import type { EpisodeRow, EpisodeType } from '@abstrack/types';
import { isEpisodeType } from '@abstrack/types';

/** Upper bound for SQLite reads used when the Supabase network path fails (offline). */
export const POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE = 50;

function optionalUuid(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

function requiredUuid(value: unknown): string | null {
  const s = optionalUuid(value);
  return s;
}

/**
 * Maps a PowerSync `episodes` SQLite row (including implicit `id`) to {@link EpisodeRow}.
 *
 * @param row - Raw row object from `useQuery` / `getAll`.
 * @returns Typed episode, or `null` when required fields are invalid.
 */
export function mapSqliteRowToEpisodeRow(
  row: Record<string, unknown>,
): EpisodeRow | null {
  const id = requiredUuid(row.id);
  const user_id = requiredUuid(row.user_id);
  const started_at =
    row.started_at != null ? String(row.started_at).trim() : '';
  const created_at =
    row.created_at != null ? String(row.created_at).trim() : '';
  const updated_at =
    row.updated_at != null ? String(row.updated_at).trim() : '';
  if (!id || !user_id || !started_at || !created_at || !updated_at) {
    return null;
  }

  const rawType = row.episode_type;
  const episode_type: EpisodeType = isEpisodeType(rawType) ? rawType : 'Other';

  return {
    id,
    user_id,
    symptom_preset_id: optionalUuid(row.symptom_preset_id),
    health_marker_preset_id: optionalUuid(row.health_marker_preset_id),
    episode_type,
    episode_label: optionalUuid(row.episode_label),
    additional_notes: optionalUuid(row.additional_notes),
    note: optionalUuid(row.note),
    started_at,
    ended_at: optionalUuid(row.ended_at),
    post_marker_step_completed_at: optionalUuid(
      row.post_marker_step_completed_at,
    ),
    created_at,
    updated_at,
  };
}

/** Column projection shared by PowerSync episode SELECTs (single source of truth). */
export const EPISODE_COLUMNS =
  'id, user_id, symptom_preset_id, health_marker_preset_id, episode_type, episode_label, note, additional_notes, started_at, ended_at, post_marker_step_completed_at, created_at, updated_at';

/** Active episode: newest `started_at` among rows with `ended_at IS NULL`. */
export const POWERSYNC_SQL_ACTIVE_EPISODE = `
SELECT ${EPISODE_COLUMNS}
FROM episodes
WHERE user_id = ? AND ended_at IS NULL
ORDER BY started_at DESC
LIMIT 1
`.trim();

/** Completed episodes for offline Manage list (date filters not applied — see README). */
export const POWERSYNC_SQL_COMPLETED_EPISODES = `
SELECT ${EPISODE_COLUMNS}
FROM episodes
WHERE user_id = ? AND ended_at IS NOT NULL
ORDER BY ended_at DESC, id DESC
LIMIT ${POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE}
`.trim();
