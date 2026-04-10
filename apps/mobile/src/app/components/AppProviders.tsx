import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppThemeProvider } from '../theme/AppThemeContext';

/**
 * Global providers: safe area and app theme (system light/dark by default).
 *
 * @param props - React children.
 * @returns Provider tree.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>{children}</AppThemeProvider>
    </SafeAreaProvider>
  );
}
