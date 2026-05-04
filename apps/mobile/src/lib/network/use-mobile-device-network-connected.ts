import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import { fetchMobileDeviceIsConnected } from './mobile-device-netinfo';

/**
 * Subscribes to {@link NetInfo} so UI can tell **device offline** (no radio / no path) from
 * **online-but-sync-errors** (PowerSync upload/download failures).
 *
 * @returns `isConnected` is `null` until the first snapshot, then `true` / `false` from NetInfo.
 */
export function useMobileDeviceNetworkConnected(): {
  isConnected: boolean | null;
} {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    const apply = (connected: boolean | null) => {
      if (active) {
        setIsConnected(connected);
      }
    };

    void fetchMobileDeviceIsConnected()
      .then((connected) => {
        apply(connected);
      })
      .catch(() => {
        apply(null);
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      apply(typeof state.isConnected === 'boolean' ? state.isConnected : null);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { isConnected };
}
