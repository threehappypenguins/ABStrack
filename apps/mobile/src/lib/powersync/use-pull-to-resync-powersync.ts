import { useCallback, useRef, useState } from 'react';

import { usePowerSyncManualResync } from './PowerSyncSessionBridge';

export type UsePullToResyncPowerSyncOptions = {
  /**
   * When true, pull-to-refresh only runs {@link onAfterResync} (e.g. Supabase-only lists). Skips
   * {@link requestManualResync}, which can block on `waitForFirstSync` while offline and delay a simple
   * network reload unnecessarily.
   */
  skipPowerSyncManualResync?: boolean;
};

/**
 * Pull-to-refresh helper: runs {@link usePowerSyncManualResync} then an optional follow-up (e.g.
 * reload screen data). Uses a ref for the follow-up so callers are not forced to memoize callbacks.
 *
 * @param onAfterResync - Invoked after manual resync completes (success or failure), or alone when
 * {@link UsePullToResyncPowerSyncOptions.skipPowerSyncManualResync} is true.
 * @param options - Optional behavior flags.
 * @returns `refreshing` flag and `onRefresh` handler for `RefreshControl`.
 */
export function usePullToResyncPowerSync(
  onAfterResync?: () => void | Promise<void>,
  options?: UsePullToResyncPowerSyncOptions,
): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} {
  const { requestManualResync, manualResyncBusy } = usePowerSyncManualResync();
  const afterRef = useRef(onAfterResync);
  afterRef.current = onAfterResync;
  const skipPowerSyncRef = useRef(false);
  skipPowerSyncRef.current = options?.skipPowerSyncManualResync === true;

  const [extraBusy, setExtraBusy] = useState(false);
  const refreshing =
    (!skipPowerSyncRef.current && manualResyncBusy) || extraBusy;

  const onRefresh = useCallback(async () => {
    setExtraBusy(true);
    try {
      if (!skipPowerSyncRef.current) {
        await requestManualResync();
      }
      await afterRef.current?.();
    } finally {
      setExtraBusy(false);
    }
  }, [requestManualResync]);

  return { refreshing, onRefresh };
}
