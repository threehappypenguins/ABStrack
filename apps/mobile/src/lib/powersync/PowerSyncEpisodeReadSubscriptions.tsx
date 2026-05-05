import type { EpisodeRow } from '@abstrack/types';
import { useLayoutEffect, useRef } from 'react';

import { POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE } from './episode-powersync-read';
import {
  usePowerSyncActiveEpisodeQuery,
  usePowerSyncCompletedEpisodesQuery,
} from './use-episode-powersync-reads';

/**
 * Snapshot of replicated episode rows for UI merge logic (Home + Manage episodes).
 */
export type PowerSyncEpisodeReadSnapshots = {
  activeEpisode: EpisodeRow | null;
  activeLoading: boolean;
  /** Set when the watched active-episode SQL fails (distinct from empty result). */
  activeQueryError: Error | undefined;
  completedEpisodes: EpisodeRow[];
  completedLoading: boolean;
  /** Set when the watched completed-episodes SQL fails. */
  completedQueryError: Error | undefined;
};

/**
 * Subscribes to PowerSync episode queries and pushes snapshots to the parent.
 *
 * **Must only mount when `powerSyncReplicaSqliteReady(usePowerSyncBridgeState())` is true** (see
 * `PowerSyncSessionBridge`: `database` is non-null before `init()` completes). The upstream
 * `useQuery` hooks must not run against an uninitialized replica; gating keeps hook order stable.
 *
 * @param props.userId - Current auth user id for SQL filters.
 * @param props.endedAtOrAfter - Optional inclusive lower bound on `ended_at` for completed-episode SQL (Manage day filter).
 * @param props.endedAtOrBefore - Optional inclusive upper bound on `ended_at` for completed-episode SQL.
 * @param props.completedEpisodesFetchLimit - SQLite `LIMIT` for completed history; defaults to
 *   {@link POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE} when omitted (Manage passes a growing limit for offline paging).
 * @param props.onSnapshots - Called when query outputs change.
 * Uses `useLayoutEffect` so initial loading flags are delivered before first paint (parents should
 * not briefly treat mirror reads as settled while watched SQL is still resolving).
 * @returns Renders nothing (subscription-only).
 */
export function PowerSyncEpisodeReadSubscriptions({
  userId,
  endedAtOrAfter = null,
  endedAtOrBefore = null,
  completedEpisodesFetchLimit,
  onSnapshots,
}: {
  userId: string | null;
  endedAtOrAfter?: string | null;
  endedAtOrBefore?: string | null;
  /** SQLite `LIMIT` for completed history (Manage increases while paging offline). */
  completedEpisodesFetchLimit?: number;
  onSnapshots: (snapshots: PowerSyncEpisodeReadSnapshots) => void;
}) {
  const psActive = usePowerSyncActiveEpisodeQuery(userId);
  const psCompleted = usePowerSyncCompletedEpisodesQuery(
    userId,
    endedAtOrAfter,
    endedAtOrBefore,
    completedEpisodesFetchLimit ?? POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE,
  );
  const onSnapshotsRef = useRef(onSnapshots);
  onSnapshotsRef.current = onSnapshots;

  useLayoutEffect(() => {
    onSnapshotsRef.current({
      activeEpisode: psActive.episode,
      activeLoading: psActive.isLoading,
      activeQueryError: psActive.error,
      completedEpisodes: psCompleted.episodes,
      completedLoading: psCompleted.isLoading,
      completedQueryError: psCompleted.error,
    });
  }, [
    psActive.episode,
    psActive.error,
    psActive.isLoading,
    psCompleted.episodes,
    psCompleted.error,
    psCompleted.isLoading,
    completedEpisodesFetchLimit,
  ]);

  return null;
}
