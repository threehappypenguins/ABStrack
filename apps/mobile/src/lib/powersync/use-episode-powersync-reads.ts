import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

import type { EpisodeRow } from '@abstrack/types';

import {
  mapSqliteRowToEpisodeRow,
  POWERSYNC_COMPLETED_ENDED_AT_MAX,
  POWERSYNC_COMPLETED_ENDED_AT_MIN,
  POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE,
  POWERSYNC_SQL_ACTIVE_EPISODE,
  POWERSYNC_SQL_COMPLETED_EPISODES,
  POWERSYNC_SQL_EPISODE_WATCH_IDLE,
} from './episode-powersync-read';

/** Non-null trimmed patient id when the caller passed a usable auth subject for episode reads. */
function episodeReadUserIdTrimmed(userId: string | null): string | null {
  if (typeof userId !== 'string') {
    return null;
  }
  const t = userId.trim();
  return t !== '' ? t : null;
}

function mapEpisodeRows(data: unknown): EpisodeRow[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: EpisodeRow[] = [];
  for (const raw of data) {
    if (raw && typeof raw === 'object') {
      const row = mapSqliteRowToEpisodeRow(raw as Record<string, unknown>);
      if (row) {
        out.push(row);
      }
    }
  }
  return out;
}

/**
 * Reads the active episode row from replicated SQLite (PowerSync), mirroring
 * {@link getActiveEpisodeForUser} ordering.
 *
 * @param userId - Patient user id; when absent or blank, runs {@link POWERSYNC_SQL_EPISODE_WATCH_IDLE}
 * so PowerSync does not keep the active-episode SQL subscribed with a dummy bind (sign-out /
 * account-switch friendly).
 */
export function usePowerSyncActiveEpisodeQuery(userId: string | null) {
  const trimmedUserId = episodeReadUserIdTrimmed(userId);
  const sql =
    trimmedUserId != null
      ? POWERSYNC_SQL_ACTIVE_EPISODE
      : POWERSYNC_SQL_EPISODE_WATCH_IDLE;
  const params = useMemo(
    () => (trimmedUserId != null ? [trimmedUserId] : []),
    [trimmedUserId],
  );
  const result = useQuery(sql, params);
  const episodes = useMemo(() => mapEpisodeRows(result.data), [result.data]);
  return {
    ...result,
    episodes,
    episode: episodes[0] ?? null,
  };
}

/**
 * Reads completed episodes from SQLite for offline Manage → Episodes, with optional inclusive
 * `ended_at` bounds aligned with `listCompletedEpisodesForUser` in `@abstrack/supabase`.
 *
 * @param userId - Patient user id; when absent or blank, runs {@link POWERSYNC_SQL_EPISODE_WATCH_IDLE}
 * (same rationale as {@link usePowerSyncActiveEpisodeQuery}).
 * @param endedAtOrAfter - Inclusive lower bound on `ended_at`, or null/undefined for no lower filter.
 * @param endedAtOrBefore - Inclusive upper bound on `ended_at`, or null/undefined for no upper filter.
 * @param fetchLimit - `LIMIT` bind (grow to load more offline rows; defaults to {@link POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE}).
 */
export function usePowerSyncCompletedEpisodesQuery(
  userId: string | null,
  endedAtOrAfter?: string | null,
  endedAtOrBefore?: string | null,
  fetchLimit: number = POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE,
) {
  const trimmedUserId = episodeReadUserIdTrimmed(userId);
  const sql =
    trimmedUserId != null
      ? POWERSYNC_SQL_COMPLETED_EPISODES
      : POWERSYNC_SQL_EPISODE_WATCH_IDLE;
  const params = useMemo(
    () =>
      trimmedUserId != null
        ? [
            trimmedUserId,
            endedAtOrAfter != null && String(endedAtOrAfter).trim() !== ''
              ? String(endedAtOrAfter).trim()
              : POWERSYNC_COMPLETED_ENDED_AT_MIN,
            endedAtOrBefore != null && String(endedAtOrBefore).trim() !== ''
              ? String(endedAtOrBefore).trim()
              : POWERSYNC_COMPLETED_ENDED_AT_MAX,
            Math.max(1, Math.floor(fetchLimit)),
          ]
        : [],
    [trimmedUserId, endedAtOrAfter, endedAtOrBefore, fetchLimit],
  );
  const result = useQuery(sql, params);
  const episodes = useMemo(() => mapEpisodeRows(result.data), [result.data]);
  return { ...result, episodes };
}
