import type { EpisodeRow, EpisodeType } from '@abstrack/types';
import { isEpisodeType } from '@abstrack/types';

/**
 * Default page size for offline completed-episode SQLite reads (aligned with Manage’s
 * `listCompletedEpisodesForUser` first page).
 */
export const POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE = 25;

/**
 * Inclusive `ended_at` lower bound placeholder when the UI does not pass `endedAtOrAfter`
 * (ISO 8601 so string comparison matches Postgres timestamptz ordering in SQLite).
 */
export const POWERSYNC_COMPLETED_ENDED_AT_MIN = '1970-01-01T00:00:00.000Z';

/**
 * Inclusive `ended_at` upper bound placeholder when the UI does not pass `endedAtOrBefore`.
 */
export const POWERSYNC_COMPLETED_ENDED_AT_MAX = '9999-12-31T23:59:59.999Z';

function optionalText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

function requiredText(value: unknown): string | null {
  const s = optionalText(value);
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
  const id = requiredText(row.id);
  const user_id = requiredText(row.user_id);
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
    symptom_preset_id: optionalText(row.symptom_preset_id),
    health_marker_preset_id: optionalText(row.health_marker_preset_id),
    episode_type,
    episode_label: optionalText(row.episode_label),
    additional_notes: optionalText(row.additional_notes),
    note: optionalText(row.note),
    started_at,
    ended_at: optionalText(row.ended_at),
    post_marker_step_completed_at: optionalText(
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

/**
 * Completed episodes for offline Manage list. Bind
 * `[userId, endedAtOrAfter, endedAtOrBefore, limit]`:
 * use {@link POWERSYNC_COMPLETED_ENDED_AT_MIN} / {@link POWERSYNC_COMPLETED_ENDED_AT_MAX} when the
 * UI has no date filter so the range is effectively unbounded (matches `listCompletedEpisodesForUser`
 * inclusive `gte` / `lte`). The fourth bind is **`LIMIT ?`** (grow it to page offline history when
 * the network list is unavailable).
 */
export const POWERSYNC_SQL_COMPLETED_EPISODES = `
SELECT ${EPISODE_COLUMNS}
FROM episodes
WHERE user_id = ?
  AND ended_at IS NOT NULL
  AND ended_at >= ?
  AND ended_at <= ?
ORDER BY ended_at DESC, id DESC
LIMIT ?
`.trim();
