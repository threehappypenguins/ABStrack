'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredTheme,
  writeStoredTheme,
  type ThemePreference,
} from '@/lib/theme-storage';

type ThemeContextValue = {
  /** Current user preference (system means follow OS). */
  preference: ThemePreference;
  /** Updates preference, persists, and applies to the document immediately (before the next paint). */
  setPreference: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * React context for theme preference; wraps the app to sync DOM, localStorage, and system changes.
 * Initial state is `system` so server and client first render match for hydration; a mount-only
 * {@link useLayoutEffect} reads {@link readStoredTheme} and applies before paint.
 *
 * @param props - Props.
 * @returns Provider tree.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useLayoutEffect(() => {
    const stored = readStoredTheme();
    setPreferenceState(stored);
    applyThemeToDocument(stored);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    writeStoredTheme(pref);
    applyThemeToDocument(pref);
  }, []);

  useEffect(() => {
    applyThemeToDocument(preference);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeToDocument('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) {
        return;
      }
      setPreferenceState(readStoredTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * @returns Theme context value.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
