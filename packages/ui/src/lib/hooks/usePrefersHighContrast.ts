import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Reflects the user's high-contrast preference on web (`prefers-contrast: more`).
 * On native, returns `false` until platform hooks are wired app-wide.
 *
 * Uses `addEventListener` when available and falls back to legacy `addListener` /
 * `removeListener` for older Safari and similar engines.
 *
 * @returns Whether a high-contrast presentation is preferred.
 */
export function usePrefersHighContrast(): boolean {
  const [high, setHigh] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(prefers-contrast: more)');
    const apply = () => {
      setHigh(mq.matches);
    };
    apply();

    if ('addEventListener' in mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => {
        mq.removeEventListener('change', apply);
      };
    }

    if ('addListener' in mq && typeof mq.addListener === 'function') {
      mq.addListener(apply);
      return () => {
        if ('removeListener' in mq && typeof mq.removeListener === 'function') {
          mq.removeListener(apply);
        }
      };
    }

    return undefined;
  }, []);

  return high;
}
