import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationShell } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import { AppGridBackground } from './AppGridBackground';

export type AppNavigationShellProps = {
  /** Visible screen title; header semantics come from {@link NavigationShell}'s header container. */
  title: string;
  /** Optional trailing header action, such as the authenticated menu button. */
  headerAction?: React.ReactNode;
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
  headerAction,
  children,
}: AppNavigationShellProps) {
  const { colors } = useAppTheme();

  return (
    <AppGridBackground>
      <SafeAreaView className="flex-1" edges={['top', 'left', 'right']}>
        <NavigationShell
          style={{ flex: 1, backgroundColor: 'transparent' }}
          headerStyle={{
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          }}
          mainStyle={{ flex: 1, backgroundColor: 'transparent' }}
          header={
            <View className="flex-row items-center justify-between gap-3">
              <Text
                className={`min-w-0 flex-1 text-xl font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
                numberOfLines={1}
              >
                {title}
              </Text>
              {headerAction ? <View>{headerAction}</View> : null}
            </View>
          }
        >
          {children}
        </NavigationShell>
      </SafeAreaView>
    </AppGridBackground>
  );
}
