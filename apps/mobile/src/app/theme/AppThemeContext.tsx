import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  colorScheme as nativeWindColorScheme,
  useColorScheme as useNativeWindColorScheme,
} from 'nativewind';
import {
  DarkTheme,
  DefaultTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import {
  darkAppColors,
  lightAppColors,
  type AppThemeColors,
} from './app-colors';
import {
  getThemePreference,
  setThemePreference as persistThemePreference,
  type ThemePreference,
} from '../theme-preference';

export type AppColorScheme = 'light' | 'dark';

export type AppThemeContextValue = {
  /** Effective UI appearance used for Navigation, StatusBar, and `dark:` classes. */
  colorScheme: AppColorScheme;
  /** Stored user choice; applied with NativeWind `colorScheme.set`. */
  themePreference: ThemePreference;
  /**
   * Persists preference and applies it via NativeWind `colorScheme.set` (requires
   * `darkMode: 'class'` in `tailwind.config.js`).
   *
   * @param preference - `system` follows the device; `light` / `dark` override it.
   */
  setThemePreference: (preference: ThemePreference) => Promise<void>;
  colors: AppThemeColors;
  /** React Navigation container theme (cards, headers, tab chrome). */
  navigationTheme: NavigationTheme;
  /** Expo StatusBar style: dark icons on light bg, light icons on dark bg. */
  statusBarStyle: 'light' | 'dark';
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function buildNavigationTheme(
  colors: AppThemeColors,
  scheme: AppColorScheme,
): NavigationTheme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.surface,
      text: colors.ink,
      border: colors.border,
      notification: colors.primary,
    },
  };
}

/**
 * Provides semantic colors and NativeWind appearance. Loads persisted
 * {@link ThemePreference} on mount and applies it with `colorScheme` from `nativewind`
 * (`darkMode: 'class'` in `tailwind.config.js`).
 *
 * @param props - React children.
 * @returns Context provider.
 */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme: nwScheme } = useNativeWindColorScheme();
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>('system');
  /**
   * When the user changes theme from Settings (or elsewhere), late completion of the
   * initial `getThemePreference()` read must not overwrite their choice.
   */
  const userChosePreferenceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getThemePreference().then((stored) => {
      if (cancelled || userChosePreferenceRef.current) {
        return;
      }
      nativeWindColorScheme.set(stored);
      setThemePreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const colorScheme: AppColorScheme = nwScheme === 'dark' ? 'dark' : 'light';
  const colors = colorScheme === 'dark' ? darkAppColors : lightAppColors;

  const setThemePreference = useCallback(
    async (preference: ThemePreference) => {
      userChosePreferenceRef.current = true;
      try {
        await persistThemePreference(preference);
        nativeWindColorScheme.set(preference);
        setThemePreferenceState(preference);
      } catch (error) {
        userChosePreferenceRef.current = false;
        throw error;
      }
    },
    [],
  );

  const value = useMemo((): AppThemeContextValue => {
    return {
      colorScheme,
      themePreference,
      setThemePreference,
      colors,
      navigationTheme: buildNavigationTheme(colors, colorScheme),
      statusBarStyle: colorScheme === 'dark' ? 'light' : 'dark',
    };
  }, [colorScheme, colors, setThemePreference, themePreference]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

/**
 * @returns Active app theme and NativeWind-backed theme preference.
 */
export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return ctx;
}
