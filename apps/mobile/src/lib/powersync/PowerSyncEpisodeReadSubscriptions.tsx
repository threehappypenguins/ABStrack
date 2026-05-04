import type { EpisodeRow } from '@abstrack/types';
import { useEffect } from 'react';

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
  completedEpisodes: EpisodeRow[];
  completedLoading: boolean;
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
 * @param props.onSnapshots - Called when query outputs change.
 * @returns Renders nothing (subscription-only).
 */
export function PowerSyncEpisodeReadSubscriptions({
  userId,
  endedAtOrAfter = null,
  endedAtOrBefore = null,
  onSnapshots,
}: {
  userId: string | null;
  endedAtOrAfter?: string | null;
  endedAtOrBefore?: string | null;
  onSnapshots: (snapshots: PowerSyncEpisodeReadSnapshots) => void;
}) {
  const psActive = usePowerSyncActiveEpisodeQuery(userId);
  const psCompleted = usePowerSyncCompletedEpisodesQuery(
    userId,
    endedAtOrAfter,
    endedAtOrBefore,
  );

  useEffect(() => {
    onSnapshots({
      activeEpisode: psActive.episode,
      activeLoading: psActive.isLoading,
      completedEpisodes: psCompleted.episodes,
      completedLoading: psCompleted.isLoading,
    });
  }, [
    onSnapshots,
    psActive.episode,
    psActive.isLoading,
    psCompleted.episodes,
    psCompleted.isLoading,
  ]);

  return null;
}
