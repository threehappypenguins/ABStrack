import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
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

export type AppColorScheme = 'light' | 'dark';

export type AppThemeContextValue = {
  /** Resolved appearance (`null` from RN is treated as light). */
  colorScheme: AppColorScheme;
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
 * Provides semantic colors from the active color scheme (follows system appearance via React Native's
 * {@link https://reactnative.dev/docs/usecolorscheme | useColorScheme}).
 *
 * @param props - React children.
 * @returns Context provider.
 */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const rnScheme = useRNColorScheme();
  const colorScheme: AppColorScheme = rnScheme === 'dark' ? 'dark' : 'light';
  const colors = colorScheme === 'dark' ? darkAppColors : lightAppColors;

  const value = useMemo((): AppThemeContextValue => {
    return {
      colorScheme,
      colors,
      navigationTheme: buildNavigationTheme(colors, colorScheme),
      statusBarStyle: colorScheme === 'dark' ? 'light' : 'dark',
    };
  }, [colorScheme, colors]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

/**
 * @returns Active app theme (system-driven until a manual preference exists).
 */
export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return ctx;
}
