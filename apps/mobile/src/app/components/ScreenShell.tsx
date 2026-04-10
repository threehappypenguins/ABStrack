import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/AppThemeContext';

/**
 * Auth and form screens: safe area, centered layout, card surface aligned with web app shell.
 *
 * @param props - Child content inside the card.
 * @returns Themed shell layout.
 */
export function ScreenShell({ children }: { children: React.ReactNode }) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView
      style={[styles.outer, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            shadowColor: colors.shadow,
            shadowOpacity: colors.shadowOpacity,
          },
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2,
  },
});
