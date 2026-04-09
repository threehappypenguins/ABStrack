/**
 * Browser persistence and DOM application for color scheme preference (light / dark / system).
 */

/** localStorage key; absent value means follow OS (system). */
export const THEME_STORAGE_KEY = 'abstrack-theme';

/** User-selectable theme; `system` is the default and does not persist. */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Reads the stored preference, or `system` when unset, invalid, or storage is unavailable.
 *
 * @returns Resolved preference from storage.
 */
export function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark') {
      return v;
    }
  } catch {
    // `localStorage` can throw when blocked, in some privacy modes, or when quota is exceeded.
  }
  return 'system';
}

/**
 * Persists explicit light/dark only; `system` clears storage so the default applies.
 * Swallows storage errors so a blocked `localStorage` does not break the app.
 *
 * @param pref - Preference to store.
 */
export function writeStoredTheme(pref: ThemePreference): void {
  try {
    if (pref === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    // Same environments that block reads often block writes; in-memory theme still applies.
  }
}

/**
 * Applies `pref` to `document.documentElement.classList` (`dark` toggles Tailwind dark mode).
 * For `system`, uses `prefers-color-scheme`.
 *
 * @param pref - Preference to apply.
 */
export function applyThemeToDocument(pref: ThemePreference): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (pref === 'light') {
    root.classList.remove('dark');
  } else if (pref === 'dark') {
    root.classList.add('dark');
  } else {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', dark);
  }
}
