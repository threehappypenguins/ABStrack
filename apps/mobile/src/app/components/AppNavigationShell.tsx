import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationShell } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';

export type AppNavigationShellProps = {
  /** Visible screen title; header semantics come from {@link NavigationShell}'s header container. */
  title: string;
  children: React.ReactNode;
};

/**
 * Authenticated-area layout: safe area (above bottom tab bar), {@link NavigationShell}
 * header with title, and main content. Uses shared `@abstrack/ui` chrome with web-aligned colors.
 *
 * @param props - Title and main subtree.
 * @returns Shell-wrapped screen content.
 */
export function AppNavigationShell({
  title,
  children,
}: AppNavigationShellProps) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView
      style={[shellStyles.safeArea, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      <NavigationShell
        style={[shellStyles.shellRoot, { backgroundColor: colors.bg }]}
        headerStyle={[
          shellStyles.headerChrome,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
        mainStyle={{ backgroundColor: colors.bg }}
        header={
          <Text
            style={[shellStyles.headerTitle, { color: colors.ink }]}
            maxFontSizeMultiplier={2}
          >
            {title}
          </Text>
        }
      >
        {children}
      </NavigationShell>
    </SafeAreaView>
  );
}

const shellStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  shellRoot: {
    flex: 1,
  },
  headerChrome: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
});
