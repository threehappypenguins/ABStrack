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
 * Initial state is always `system` so the server HTML and the client's first hydrated render match
 * (SSR has no `localStorage`; {@link readStoredTheme} in `useState`
 * would otherwise diverge). A mount-only {@link useLayoutEffect} reads storage and applies the
 * theme before paint so stored light/dark and UI (for example {@link ThemeMenu} trigger icon) align
 * immediately without hydration mismatches.
 *
 * User-driven changes call {@link applyThemeToDocument} inside `setPreference` so the class on
 * `<html>` updates immediately; the `[preference]` effect still reconciles other update paths.
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

  /** Keeps the DOM aligned when `preference` changes without `setPreference` (e.g. `storage`). */
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
