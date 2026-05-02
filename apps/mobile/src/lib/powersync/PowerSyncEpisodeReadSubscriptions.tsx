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
 * **Must only mount when `usePowerSyncBridgeState().database` is non-null.** The upstream
 * `useQuery` hook calls fewer internal hooks when PowerSync is not configured; mounting this only
 * after the DB exists keeps the hook order stable (React rules of hooks).
 *
 * @param props.userId - Current auth user id for SQL filters.
 * @param props.onSnapshots - Called when query outputs change.
 * @returns Renders nothing (subscription-only).
 */
export function PowerSyncEpisodeReadSubscriptions({
  userId,
  onSnapshots,
}: {
  userId: string | null;
  onSnapshots: (snapshots: PowerSyncEpisodeReadSnapshots) => void;
}) {
  const psActive = usePowerSyncActiveEpisodeQuery(userId);
  const psCompleted = usePowerSyncCompletedEpisodesQuery(userId);

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
