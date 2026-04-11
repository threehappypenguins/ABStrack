import * as SecureStore from 'expo-secure-store';

const THEME_PREFERENCE_KEY = 'abstrack.theme_preference';

/** User-facing appearance: follow OS, or lock to light / dark. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * @returns Stored theme preference, or `system` if missing or invalid.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    return 'system';
  } catch {
    return 'system';
  }
}

/**
 * Persists the user’s theme choice for the next app launch.
 *
 * @param preference - Theme to store.
 */
export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
  } catch {
    throw new Error('Unable to save theme preference.');
  }
}
