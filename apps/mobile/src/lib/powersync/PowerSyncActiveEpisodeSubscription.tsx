import type { EpisodeRow } from '@abstrack/types';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { usePowerSyncActiveEpisodeQuery } from './use-episode-powersync-reads';

/**
 * Subscribes to the replicated active-episode query and notifies the parent.
 *
 * **Mount only when the replica is opened for SQL** — gate with
 * `powerSyncReplicaSqliteReady` from `PowerSyncSessionBridge` (`database` is assigned before
 * `init()` finishes on cold start). Upstream `useQuery` must not run against an uninitialized
 * handle; gating avoids that and keeps hooks order stable.
 *
 * On **unmount** (e.g. parent gates the replica off while `database` stays the same), clears the
 * parent snapshot so UI does not keep the last row/error until a new subscription runs.
 *
 * @param props.userId - Auth user id for SQL.
 * @param props.onChange - Latest row, loading flag, and watched-query error (if any).
 * Uses `useLayoutEffect` so the initial `isLoading` snapshot is delivered in the same commit before
 * paint; parents do not briefly render a stale default while the query is already loading.
 * @returns Renders nothing.
 */
export function PowerSyncActiveEpisodeSubscription({
  userId,
  onChange,
}: {
  userId: string | null;
  onChange: (snap: {
    episode: EpisodeRow | null;
    isLoading: boolean;
    error: Error | undefined;
  }) => void;
}) {
  const ps = usePowerSyncActiveEpisodeQuery(userId);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    onChangeRef.current({
      episode: ps.episode,
      isLoading: ps.isLoading,
      error: ps.error,
    });
  }, [ps.episode, ps.error, ps.isLoading]);

  useEffect(() => {
    return () => {
      onChangeRef.current({
        episode: null,
        isLoading: false,
        error: undefined,
      });
    };
  }, []);

  return null;
}
