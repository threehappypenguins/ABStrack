import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import {
  fetchMobileDeviceIsConnected,
  mapNetInfoStateToAppOnline,
} from './mobile-device-netinfo';

/**
 * Subscribes to {@link NetInfo} so UI can tell **device offline** (no radio / no path) from
 * **online-but-sync-errors** (PowerSync upload/download failures).
 *
 * Initial {@link fetchMobileDeviceIsConnected} runs alongside {@link NetInfo.addEventListener}. If
 * any listener snapshot is delivered before fetch settles (including an initial synchronous callback),
 * the fetch result is ignored so a slower {@link NetInfo.fetch} cannot overwrite fresher connectivity
 * (e.g. sync footer right after mount).
 *
 * @returns `isConnected` is `null` until the first snapshot, then `true` / `false` using the same
 * rules as {@link mapNetInfoStateToAppOnline} (not raw NetInfo `isConnected` alone).
 */
export function useMobileDeviceNetworkConnected(): {
  isConnected: boolean | null;
} {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    /**
     * Increments on every {@link NetInfo.addEventListener} callback. When {@link fetchMobileDeviceIsConnected}
     * finishes, its result is applied only if this is still `0` — i.e. no listener snapshot has been
     * delivered yet. Otherwise the fetch snapshot can be older than the last listener update (including
     * the initial synchronous callback some platforms emit on subscribe).
     */
    let listenerSnapshotCount = 0;

    const apply = (connected: boolean | null) => {
      if (active) {
        setIsConnected(connected);
      }
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      listenerSnapshotCount += 1;
      apply(mapNetInfoStateToAppOnline(state));
    });

    void (async () => {
      let fetched: boolean | null;
      try {
        fetched = await fetchMobileDeviceIsConnected();
      } catch {
        fetched = null;
      }
      if (!active) {
        return;
      }
      if (listenerSnapshotCount > 0) {
        return;
      }
      apply(fetched);
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { isConnected };
}
