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
 * a listener snapshot with **resolved** online/offline ({@link mapNetInfoStateToAppOnline} not
 * `null`) arrives before fetch settles, the fetch result is ignored so a slower
 * {@link NetInfo.fetch} cannot overwrite fresher connectivity. Initial callbacks that are still
 * unknown (`null`) do not block fetch, so the hook is not stuck at `null` until the next transition.
 *
 * @returns `isConnected` is `null` until the first **definite** online/offline value (listener or
 * fetch). Transient listener snapshots that map to `null` do not clear an established
 * `true` / `false` (see {@link mapNetInfoStateToAppOnline}).
 */
export function useMobileDeviceNetworkConnected(): {
  isConnected: boolean | null;
} {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    /**
     * Increments when the listener delivers a **non-null** {@link mapNetInfoStateToAppOnline} value.
     * Unknown snapshots (`null`) do not increment so an initial “still resolving” callback does not
     * suppress {@link fetchMobileDeviceIsConnected} when fetch has a definite result.
     */
    let listenerResolvedConnectivityCount = 0;

    /**
     * Once a definite `true`/`false` was applied (from listener or fetch), ignore later `null`
     * snapshots so NetInfo “unknown” blips do not erase the last known reachability.
     */
    let definiteConnectivityEstablished = false;

    const apply = (connected: boolean | null) => {
      if (!active) {
        return;
      }
      if (connected !== null) {
        definiteConnectivityEstablished = true;
        setIsConnected(connected);
        return;
      }
      if (!definiteConnectivityEstablished) {
        setIsConnected(null);
      }
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      const mapped = mapNetInfoStateToAppOnline(state);
      if (mapped !== null) {
        listenerResolvedConnectivityCount += 1;
      }
      apply(mapped);
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
      if (listenerResolvedConnectivityCount > 0) {
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
