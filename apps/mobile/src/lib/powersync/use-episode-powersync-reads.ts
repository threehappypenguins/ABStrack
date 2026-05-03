import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

import type { EpisodeRow } from '@abstrack/types';

import {
  mapSqliteRowToEpisodeRow,
  POWERSYNC_COMPLETED_ENDED_AT_MAX,
  POWERSYNC_COMPLETED_ENDED_AT_MIN,
  POWERSYNC_SQL_ACTIVE_EPISODE,
  POWERSYNC_SQL_COMPLETED_EPISODES,
} from './episode-powersync-read';

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
 * @param userId - Patient user id; when `null`, the query is inert.
 */
export function usePowerSyncActiveEpisodeQuery(userId: string | null) {
  const params = useMemo(() => [userId ?? ''], [userId]);
  const result = useQuery(POWERSYNC_SQL_ACTIVE_EPISODE, params);
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
 * @param userId - Patient user id; when `null`, the query is inert.
 * @param endedAtOrAfter - Inclusive lower bound on `ended_at`, or null/undefined for no lower filter.
 * @param endedAtOrBefore - Inclusive upper bound on `ended_at`, or null/undefined for no upper filter.
 */
export function usePowerSyncCompletedEpisodesQuery(
  userId: string | null,
  endedAtOrAfter?: string | null,
  endedAtOrBefore?: string | null,
) {
  const params = useMemo(
    () => [
      userId ?? '',
      endedAtOrAfter != null && String(endedAtOrAfter).trim() !== ''
        ? String(endedAtOrAfter).trim()
        : POWERSYNC_COMPLETED_ENDED_AT_MIN,
      endedAtOrBefore != null && String(endedAtOrBefore).trim() !== ''
        ? String(endedAtOrBefore).trim()
        : POWERSYNC_COMPLETED_ENDED_AT_MAX,
    ],
    [userId, endedAtOrAfter, endedAtOrBefore],
  );
  const result = useQuery(POWERSYNC_SQL_COMPLETED_EPISODES, params);
  const episodes = useMemo(() => mapEpisodeRows(result.data), [result.data]);
  return { ...result, episodes };
}
