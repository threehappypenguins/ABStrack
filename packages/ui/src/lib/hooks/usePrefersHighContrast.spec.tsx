import { act, renderHook, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';
import { usePrefersHighContrast } from './usePrefersHighContrast.js';

describe('usePrefersHighContrast', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalOs,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MediaQueryList with addEventListener', () => {
    let matchesState: boolean;
    let changeListeners: Array<() => void>;

    beforeEach(() => {
      matchesState = false;
      changeListeners = [];
      const mq = {
        get matches() {
          return matchesState;
        },
        media: '(prefers-contrast: more)',
        addEventListener(type: string, fn: () => void) {
          if (type === 'change') {
            changeListeners.push(fn);
          }
        },
        removeEventListener(type: string, fn: () => void) {
          changeListeners = changeListeners.filter((f) => f !== fn);
        },
      };
      vi.spyOn(window, 'matchMedia').mockReturnValue(
        mq as unknown as MediaQueryList,
      );
    });

    function fireChange() {
      act(() => {
        changeListeners.forEach((fn) => {
          fn();
        });
      });
    }

    it('reflects initial prefers-contrast: more', async () => {
      matchesState = true;
      const { result } = renderHook(() => usePrefersHighContrast());
      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('updates when the media query result changes', async () => {
      matchesState = false;
      const { result } = renderHook(() => usePrefersHighContrast());
      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      matchesState = true;
      fireChange();

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });
  });

  describe('legacy MediaQueryList (addListener / removeListener)', () => {
    let matchesState: boolean;
    let legacyListeners: Array<() => void>;

    beforeEach(() => {
      matchesState = false;
      legacyListeners = [];
      const mq = {
        get matches() {
          return matchesState;
        },
        media: '(prefers-contrast: more)',
        addListener(fn: () => void) {
          legacyListeners.push(fn);
        },
        removeListener(fn: () => void) {
          legacyListeners = legacyListeners.filter((f) => f !== fn);
        },
      };
      vi.spyOn(window, 'matchMedia').mockReturnValue(
        mq as unknown as MediaQueryList,
      );
    });

    function fireLegacyChange() {
      act(() => {
        legacyListeners.forEach((fn) => {
          fn();
        });
      });
    }

    it('subscribes via addListener and updates on change', async () => {
      matchesState = false;
      const { result } = renderHook(() => usePrefersHighContrast());
      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      matchesState = true;
      fireLegacyChange();

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });
  });
});
