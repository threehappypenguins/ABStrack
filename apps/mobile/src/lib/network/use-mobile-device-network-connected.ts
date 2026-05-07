import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import {
  fetchMobileDeviceIsConnected,
  mapNetInfoStateToAppOnline,
} from './mobile-device-netinfo';

/**
 * NetInfo often invokes the subscription handler immediately with a **cached** snapshot (sometimes
 * still “offline” right after reconnect). {@link NetInfo.fetch} typically reflects a fresher read by
 * the time its promise resolves. We only override an early listener **`false`** with fetch **`true`**
 * when that listener fired inside this window after subscribe — avoiding the opposite failure mode
 * where a delayed {@link NetInfo.fetch} would overwrite a listener that already showed **`true`**.
 */
const INITIAL_LISTENER_OFFLINE_MAY_BE_STALE_MS = 150;

/**
 * Subscribes to {@link NetInfo} so UI can tell **device offline** (no radio / no path) from
 * **online-but-sync-errors** (PowerSync upload/download failures).
 *
 * Initial {@link fetchMobileDeviceIsConnected} runs alongside {@link NetInfo.addEventListener}.
 * If the listener delivers a **resolved** online/offline ({@link mapNetInfoStateToAppOnline} not
 * `null`) **before** fetch settles, fetch is usually ignored so a slower {@link NetInfo.fetch}
 * cannot overwrite fresher connectivity — **except** when the listener’s first definite snapshot is
 * **`false`** inside {@link INITIAL_LISTENER_OFFLINE_MAY_BE_STALE_MS} of subscribe and fetch reports
 * **`true`**, which reconciles cached post-reconnect “offline” listeners with a fresher fetch.
 * Initial callbacks that are still unknown (`null`) do not block fetch, so the hook is not stuck at
 * `null` until the next transition.
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
    const subscribeAt = Date.now();

    /**
     * Increments when the listener delivers a **non-null** {@link mapNetInfoStateToAppOnline} value.
     * Unknown snapshots (`null`) do not increment so an initial “still resolving” callback does not
     * suppress {@link fetchMobileDeviceIsConnected} when fetch has a definite result.
     */
    let listenerResolvedConnectivityCount = 0;

    /** Timestamp of the first definite listener snapshot (`mapped !== null`), if any. */
    let firstListenerDefiniteAt: number | null = null;

    /** Latest definite value from the listener only (not from fetch reconciliation). */
    let lastListenerDefiniteValue: boolean | null = null;

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
        if (firstListenerDefiniteAt === null) {
          firstListenerDefiniteAt = Date.now();
        }
        lastListenerDefiniteValue = mapped;
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
      if (fetched === null) {
        return;
      }

      const listenerOfflineMayBeCachedStale =
        firstListenerDefiniteAt != null &&
        firstListenerDefiniteAt - subscribeAt <=
          INITIAL_LISTENER_OFFLINE_MAY_BE_STALE_MS &&
        lastListenerDefiniteValue === false &&
        fetched === true;

      if (listenerOfflineMayBeCachedStale) {
        apply(fetched);
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
