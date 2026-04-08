import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Reflects the user's high-contrast preference on web (`prefers-contrast: more`).
 * On native, returns `false` until platform hooks are wired app-wide.
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
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return high;
}
