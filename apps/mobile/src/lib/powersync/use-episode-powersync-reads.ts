import { useMemo } from 'react';
import { useQuery } from '@powersync/react';

import type { EpisodeRow } from '@abstrack/types';

import {
  mapSqliteRowToEpisodeRow,
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
 * Reads completed episodes from SQLite for offline Manage → Episodes (no date-range filters).
 *
 * @param userId - Patient user id; when `null`, the query is inert.
 */
export function usePowerSyncCompletedEpisodesQuery(userId: string | null) {
  const params = useMemo(() => [userId ?? ''], [userId]);
  const result = useQuery(POWERSYNC_SQL_COMPLETED_EPISODES, params);
  const episodes = useMemo(() => mapEpisodeRows(result.data), [result.data]);
  return { ...result, episodes };
}
