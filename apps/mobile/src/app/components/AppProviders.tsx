import React from 'react';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppThemeProvider } from '../theme/AppThemeContext';

/**
 * Global providers: safe area, app theme (NativeWind `colorScheme` + persisted theme preference),
 * and {@link ActionSheetProvider} for native-style option sheets (e.g. episode template preset pickers).
 *
 * @param props - React children.
 * @returns Provider tree.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <ActionSheetProvider>{children}</ActionSheetProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
