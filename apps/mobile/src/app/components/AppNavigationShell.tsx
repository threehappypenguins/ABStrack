import React from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationShell } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

export type AppNavigationShellProps = {
  /** Visible screen title; header semantics come from {@link NavigationShell}'s header container. */
  title: string;
  children: React.ReactNode;
};

/**
 * Authenticated-area layout: safe area (above bottom tab bar), {@link NavigationShell}
 * header with title, and main content. NativeWind uses `nw` for shell `className`; {@link NavigationShell}
 * still uses resolved theme colors in `style` props.
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
      className={`flex-1 ${nw.screenBg}`}
      edges={['top', 'left', 'right']}
    >
      <NavigationShell
        style={{ flex: 1, backgroundColor: colors.bg }}
        headerStyle={{
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        }}
        mainStyle={{ flex: 1, backgroundColor: colors.bg }}
        header={
          <Text
            className={`text-xl font-semibold ${nw.textInk}`}
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
