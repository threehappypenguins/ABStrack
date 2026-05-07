import type { EpisodeRow } from '@abstrack/types';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  mapSqliteRowToEpisodeRow,
  POWERSYNC_SQL_ACTIVE_EPISODE,
} from './episode-powersync-read';

/**
 * Reads the active episode row from the local PowerSync DB (same query as
 * {@link usePowerSyncActiveEpisodeQuery}). Use when Supabase is unreachable (e.g. airplane mode).
 *
 * @param db - Open encrypted {@link PowerSyncDatabase}.
 * @param userId - Authenticated user id.
 * @returns Newest non-ended episode row, or `null`.
 */
export async function getActiveEpisodeRowFromPowerSyncDb(
  db: PowerSyncDatabase,
  userId: string,
): Promise<EpisodeRow | null> {
  const row = await db.getOptional(POWERSYNC_SQL_ACTIVE_EPISODE, [userId]);
  if (!row || typeof row !== 'object') {
    return null;
  }
  return mapSqliteRowToEpisodeRow(row as Record<string, unknown>);
}
