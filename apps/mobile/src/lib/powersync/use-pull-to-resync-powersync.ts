import { useCallback, useRef, useState } from 'react';

import { usePowerSyncManualResync } from './PowerSyncSessionBridge';

/**
 * Pull-to-refresh helper: runs {@link usePowerSyncManualResync} then an optional follow-up (e.g.
 * reload screen data). Uses a ref for the follow-up so callers are not forced to memoize callbacks.
 *
 * @param onAfterResync - Invoked after manual resync completes (success or failure).
 * @returns `refreshing` flag and `onRefresh` handler for `RefreshControl`.
 */
export function usePullToResyncPowerSync(
  onAfterResync?: () => void | Promise<void>,
): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} {
  const { requestManualResync, manualResyncBusy } = usePowerSyncManualResync();
  const afterRef = useRef(onAfterResync);
  afterRef.current = onAfterResync;

  const [extraBusy, setExtraBusy] = useState(false);
  const refreshing = manualResyncBusy || extraBusy;

  const onRefresh = useCallback(async () => {
    setExtraBusy(true);
    try {
      await requestManualResync();
      await afterRef.current?.();
    } finally {
      setExtraBusy(false);
    }
  }, [requestManualResync]);

  return { refreshing, onRefresh };
}
