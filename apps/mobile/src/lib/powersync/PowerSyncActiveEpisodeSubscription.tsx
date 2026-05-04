import type { EpisodeRow } from '@abstrack/types';
import { useEffect } from 'react';

import { usePowerSyncActiveEpisodeQuery } from './use-episode-powersync-reads';

/**
 * Subscribes to the replicated active-episode query and notifies the parent.
 *
 * **Mount only when the replica is opened for SQL** — gate with
 * `powerSyncReplicaSqliteReady` from `PowerSyncSessionBridge` (`database` is assigned before
 * `init()` finishes on cold start). Upstream `useQuery` must not run against an uninitialized
 * handle; gating avoids that and keeps hooks order stable.
 *
 * @param props.userId - Auth user id for SQL.
 * @param props.onChange - Latest row + loading flag.
 * @returns Renders nothing.
 */
export function PowerSyncActiveEpisodeSubscription({
  userId,
  onChange,
}: {
  userId: string | null;
  onChange: (snap: { episode: EpisodeRow | null; isLoading: boolean }) => void;
}) {
  const ps = usePowerSyncActiveEpisodeQuery(userId);
  useEffect(() => {
    onChange({ episode: ps.episode, isLoading: ps.isLoading });
  }, [onChange, ps.episode, ps.isLoading]);
  return null;
}
